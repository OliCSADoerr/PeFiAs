"""
MyFinancialApp - Python Web Server
Uses only Python standard library. Serves a financial management SPA
with REST API endpoints and xlsx import capability.
"""

import http.server
import json
import os
import re
import io
import zipfile
import xml.etree.ElementTree as ET
from urllib.parse import urlparse, parse_qs
import shutil
import uuid

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(BASE_DIR, "data", "financial_data.json")
STATIC_DIR = os.path.join(BASE_DIR, "static")
UPLOADS_DIR = os.path.join(BASE_DIR, "uploads")

CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
}

PORT = 3000


def load_data():
    """Load financial data from JSON file."""
    if os.path.exists(DATA_FILE):
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {"months": []}


def save_data(data):
    """Save financial data to JSON file."""
    os.makedirs(os.path.dirname(DATA_FILE), exist_ok=True)
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def parse_xlsx(file_bytes):
    """
    Parse an xlsx file from bytes using only standard library.
    Returns a list of month dicts with expenses and incomings.
    """
    months = []
    with zipfile.ZipFile(io.BytesIO(file_bytes), "r") as z:
        # Read shared strings
        shared_strings = []
        if "xl/sharedStrings.xml" in z.namelist():
            tree = ET.parse(z.open("xl/sharedStrings.xml"))
            ns = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
            for si in tree.findall(".//s:si", ns):
                t_elem = si.find(".//s:t", ns)
                shared_strings.append(t_elem.text if t_elem is not None else "")

        # Read workbook for sheet names
        wb_tree = ET.parse(z.open("xl/workbook.xml"))
        ns_wb = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
        sheets_meta = wb_tree.findall(".//s:sheet", ns_wb)

        # Read workbook relationships to map rId to sheet files
        rel_ns = {
            "r": "http://schemas.openxmlformats.org/package/2006/relationships"
        }
        rels_tree = ET.parse(z.open("xl/_rels/workbook.xml.rels"))
        rid_map = {}
        for rel in rels_tree.findall(".//r:Relationship", rel_ns):
            rid_map[rel.get("Id")] = rel.get("Target")

        ns_sheet = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
        rel_id_attr = (
            "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
        )

        for sheet_meta in sheets_meta:
            sheet_name = sheet_meta.get("name", "Unknown")
            rid = sheet_meta.get(rel_id_attr)
            target = rid_map.get(rid, "")

            sheet_path = f"xl/{target}" if not target.startswith("/") else target[1:]
            if sheet_path not in z.namelist():
                continue

            sheet_tree = ET.parse(z.open(sheet_path))
            rows = sheet_tree.findall(".//s:sheetData/s:row", ns_sheet)

            def cell_col(ref):
                return re.match(r"([A-Z]+)", ref).group(1) if ref else ""

            def cell_value(cell_elem):
                t = cell_elem.get("t", "")
                v_elem = cell_elem.find("s:v", ns_sheet)
                val = v_elem.text if v_elem is not None else ""
                if t == "s" and val:
                    idx = int(val)
                    return shared_strings[idx] if idx < len(shared_strings) else val
                return val

            expenses = []
            incomings = []

            for row in rows:
                cells = row.findall("s:c", ns_sheet)
                cell_map = {}
                for c in cells:
                    ref = c.get("r", "")
                    col = cell_col(ref)
                    cell_map[col] = cell_value(c)

                # Skip header rows
                a_val = cell_map.get("A", "")
                e_val = cell_map.get("E", "")

                if a_val and a_val not in (
                    "Expenses",
                    "Description",
                    "Totals",
                ):
                    try:
                        amount = float(cell_map.get("C", "0") or "0")
                        due_day = int(float(cell_map.get("B", "0") or "0"))
                        expenses.append(
                            {
                                "description": a_val,
                                "due_day": due_day,
                                "amount": amount,
                            }
                        )
                    except (ValueError, TypeError):
                        pass

                if e_val and e_val not in (
                    "Incomings",
                    "Description",
                    "Totals",
                ):
                    try:
                        amount = float(cell_map.get("G", "0") or "0")
                        due_day = int(float(cell_map.get("F", "0") or "0"))
                        incomings.append(
                            {
                                "description": e_val,
                                "due_day": due_day,
                                "amount": amount,
                            }
                        )
                    except (ValueError, TypeError):
                        pass

            months.append(
                {
                    "name": sheet_name,
                    "year": 0,
                    "expenses": expenses,
                    "incomings": incomings,
                }
            )

    return months


def parse_multipart(body, boundary):
    """
    Parse multipart/form-data body manually.
    Returns (file_bytes, filename) for the first file part found, or (None, None).
    """
    boundary_bytes = boundary.encode("utf-8")
    delimiter = b"--" + boundary_bytes
    parts = body.split(delimiter)

    for part in parts:
        if part in (b"", b"--\r\n", b"--"):
            continue
        # Split headers from body
        if b"\r\n\r\n" not in part:
            continue
        header_section, file_data = part.split(b"\r\n\r\n", 1)
        # Remove trailing \r\n
        if file_data.endswith(b"\r\n"):
            file_data = file_data[:-2]

        headers_text = header_section.decode("utf-8", errors="replace")
        # Look for Content-Disposition with filename
        filename = None
        for line in headers_text.split("\r\n"):
            if "Content-Disposition" in line and "filename=" in line:
                match = re.search(r'filename="([^"]*)"', line)
                if match:
                    filename = match.group(1)
                    break

        if filename:
            return file_data, filename

    return None, None


class FinancialHandler(http.server.BaseHTTPRequestHandler):
    """Custom HTTP request handler for the financial app."""

    def log_message(self, format, *args):
        print(f"[{self.log_date_time_string()}] {format % args}")

    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_error_json(self, message, status=400):
        self.send_json({"error": message}, status)

    def serve_static(self, path):
        """Serve a static file from the static directory."""
        if path == "/" or path == "":
            path = "/index.html"

        # Sanitize path to prevent directory traversal
        safe_path = os.path.normpath(path.lstrip("/"))
        if ".." in safe_path.split(os.sep):
            self.send_error(403, "Forbidden")
            return

        file_path = os.path.join(STATIC_DIR, safe_path)
        file_path = os.path.normpath(file_path)

        # Ensure we're still within STATIC_DIR
        if not file_path.startswith(os.path.normpath(STATIC_DIR)):
            self.send_error(403, "Forbidden")
            return

        if not os.path.isfile(file_path):
            self.send_error(404, "File not found")
            return

        ext = os.path.splitext(file_path)[1].lower()
        content_type = CONTENT_TYPES.get(ext, "application/octet-stream")

        with open(file_path, "rb") as f:
            content = f.read()

        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/data":
            data = load_data()
            self.send_json(data)
        elif path.startswith("/api/"):
            self.send_error_json("Not found", 404)
        else:
            self.serve_static(path)

    def do_PUT(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/data":
            content_length = int(self.headers.get("Content-Length", 0))
            if content_length > 10 * 1024 * 1024:  # 10MB limit
                self.send_error_json("Payload too large", 413)
                return
            body = self.rfile.read(content_length)
            try:
                data = json.loads(body.decode("utf-8"))
            except (json.JSONDecodeError, UnicodeDecodeError):
                self.send_error_json("Invalid JSON")
                return

            if "months" not in data or not isinstance(data["months"], list):
                self.send_error_json("Invalid data format")
                return

            save_data(data)
            self.send_json({"success": True})
        else:
            self.send_error_json("Not found", 404)

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/import":
            content_type_header = self.headers.get("Content-Type", "")
            if "multipart/form-data" not in content_type_header:
                self.send_error_json("Expected multipart/form-data")
                return

            content_length = int(self.headers.get("Content-Length", 0))
            if content_length > 50 * 1024 * 1024:  # 50MB limit
                self.send_error_json("File too large", 413)
                return

            # Parse multipart form data manually (cgi removed in Python 3.13+)
            body = self.rfile.read(content_length)
            boundary = None
            for part in content_type_header.split(";"):
                part = part.strip()
                if part.startswith("boundary="):
                    boundary = part[len("boundary="):].strip('"')
                    break

            if not boundary:
                self.send_error_json("Missing boundary in multipart")
                return

            file_bytes, filename = parse_multipart(body, boundary)
            if file_bytes is None:
                self.send_error_json("No file uploaded")
                return

            filename = os.path.basename(filename)
            if not filename.lower().endswith(".xlsx"):
                self.send_error_json("Only .xlsx files are supported")
                return

            # Save uploaded file
            os.makedirs(UPLOADS_DIR, exist_ok=True)
            safe_name = f"{uuid.uuid4().hex}_{filename}"
            upload_path = os.path.join(UPLOADS_DIR, safe_name)
            with open(upload_path, "wb") as f:
                f.write(file_bytes)

            try:
                new_months = parse_xlsx(file_bytes)
            except Exception as e:
                self.send_error_json(f"Failed to parse xlsx: {str(e)}")
                return

            # Get year from query params or default to 0
            params = parse_qs(parsed.query)
            year = int(params.get("year", [0])[0])
            for m in new_months:
                m["year"] = year

            # Merge with existing data
            data = load_data()
            data["months"].extend(new_months)
            save_data(data)

            self.send_json(
                {
                    "success": True,
                    "imported_months": len(new_months),
                    "month_names": [m["name"] for m in new_months],
                }
            )

        elif path == "/api/month":
            # Add a new month
            content_length = int(self.headers.get("Content-Length", 0))
            if content_length > 1 * 1024 * 1024:
                self.send_error_json("Payload too large", 413)
                return
            body = self.rfile.read(content_length)
            try:
                month_data = json.loads(body.decode("utf-8"))
            except (json.JSONDecodeError, UnicodeDecodeError):
                self.send_error_json("Invalid JSON")
                return

            required = ["name", "year", "expenses", "incomings"]
            if not all(k in month_data for k in required):
                self.send_error_json("Missing required fields")
                return

            data = load_data()
            data["months"].append(month_data)
            save_data(data)
            self.send_json({"success": True})

        elif path == "/api/delete-month":
            content_length = int(self.headers.get("Content-Length", 0))
            if content_length > 1 * 1024 * 1024:
                self.send_error_json("Payload too large", 413)
                return
            body = self.rfile.read(content_length)
            try:
                req = json.loads(body.decode("utf-8"))
            except (json.JSONDecodeError, UnicodeDecodeError):
                self.send_error_json("Invalid JSON")
                return

            index = req.get("index")
            if index is None:
                self.send_error_json("Missing index")
                return

            data = load_data()
            if 0 <= index < len(data["months"]):
                data["months"].pop(index)
                save_data(data)
                self.send_json({"success": True})
            else:
                self.send_error_json("Invalid index", 404)
        else:
            self.send_error_json("Not found", 404)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()


def main():
    os.makedirs(os.path.join(BASE_DIR, "data"), exist_ok=True)
    os.makedirs(UPLOADS_DIR, exist_ok=True)

    server = http.server.HTTPServer(("0.0.0.0", PORT), FinancialHandler)
    print(f"MyFinancialApp server running on http://localhost:{PORT}")
    print("Press Ctrl+C to stop.")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
        server.server_close()


if __name__ == "__main__":
    main()
