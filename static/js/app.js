/* MyFinancialApp - Frontend JavaScript */

let appData = { months: [] };
let charts = {};
let currentTab = 'dashboard';

// ── Data Loading ───────────────────────────────────────────
async function loadData() {
  try {
    const res = await fetch('/api/data');
    if (!res.ok) throw new Error('Failed to load data');
    appData = await res.json();
    renderAll();
  } catch (err) {
    showToast('Failed to load data: ' + err.message, 'error');
  }
}

async function saveAllData() {
  try {
    collectAllEdits();
    const res = await fetch('/api/data', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(appData),
    });
    if (!res.ok) throw new Error('Failed to save');
    showToast('Data saved successfully!', 'success');
  } catch (err) {
    showToast('Failed to save: ' + err.message, 'error');
  }
}

// ── Rendering ──────────────────────────────────────────────
function renderAll() {
  renderTabs();
  renderDashboard();
  renderMonthSections();
  switchTab(currentTab);
}

function renderTabs() {
  const tabsEl = document.getElementById('tabs');
  // Keep the dashboard tab, remove the rest
  tabsEl.innerHTML = `<div class="tab ${currentTab === 'dashboard' ? 'active' : ''}" data-tab="dashboard" onclick="switchTab('dashboard')">&#128202; Dashboard</div>`;

  appData.months.forEach((month, i) => {
    const label = month.year ? `${month.name} ${month.year}` : month.name;
    const isActive = currentTab === `month-${i}` ? 'active' : '';
    tabsEl.innerHTML += `<div class="tab ${isActive}" data-tab="month-${i}" onclick="switchTab('month-${i}')">${label}</div>`;
  });
}

function switchTab(tab) {
  currentTab = tab;
  // Update tab styles
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tab);
  });
  // Show/hide sections
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  const section = document.getElementById(`section-${tab}`);
  if (section) section.classList.add('active');
}

// ── Dashboard ──────────────────────────────────────────────
function renderDashboard() {
  if (appData.months.length === 0) {
    document.getElementById('dashboard-summary').innerHTML = '<div class="empty-state"><h3>No data yet</h3><p>Import a spreadsheet to get started.</p></div>';
    document.getElementById('dashboard-charts').style.display = 'none';
    return;
  }
  document.getElementById('dashboard-charts').style.display = '';

  // Summary
  let totalIncome = 0, totalExpenses = 0;
  appData.months.forEach(m => {
    totalIncome += m.incomings.reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);
    totalExpenses += m.expenses.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
  });
  const balance = totalIncome - totalExpenses;

  document.getElementById('dashboard-summary').innerHTML = `
    <div class="summary-card">
      <div class="label">Total Income</div>
      <div class="value income">$${totalIncome.toFixed(2)}</div>
    </div>
    <div class="summary-card">
      <div class="label">Total Expenses</div>
      <div class="value expense">$${totalExpenses.toFixed(2)}</div>
    </div>
    <div class="summary-card">
      <div class="label">Net Balance</div>
      <div class="value ${balance >= 0 ? 'positive' : 'negative'}">$${balance.toFixed(2)}</div>
    </div>
    <div class="summary-card">
      <div class="label">Months Tracked</div>
      <div class="value" style="color:var(--accent-blue)">${appData.months.length}</div>
    </div>
  `;

  renderCharts();
}

function renderCharts() {
  const chartColors = {
    green: 'rgba(63,185,80,0.8)',
    greenBg: 'rgba(63,185,80,0.2)',
    red: 'rgba(248,81,73,0.8)',
    redBg: 'rgba(248,81,73,0.2)',
    blue: 'rgba(88,166,255,0.8)',
    blueBg: 'rgba(88,166,255,0.2)',
    pieColors: [
      '#58a6ff', '#3fb950', '#f85149', '#d29922',
      '#bc8cff', '#f778ba', '#79c0ff', '#56d364',
      '#ff7b72', '#e3b341',
    ],
  };

  const labels = appData.months.map(m => m.year ? `${m.name} ${m.year}` : m.name);
  const incomePerMonth = appData.months.map(m =>
    m.incomings.reduce((s, i) => s + (parseFloat(i.amount) || 0), 0)
  );
  const expensePerMonth = appData.months.map(m =>
    m.expenses.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0)
  );
  const balancePerMonth = incomePerMonth.map((inc, i) => inc - expensePerMonth[i]);

  const defaultOpts = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: '#8b949e', font: { size: 12 } } },
    },
    scales: {
      x: { ticks: { color: '#8b949e' }, grid: { color: 'rgba(48,54,61,0.5)' } },
      y: { ticks: { color: '#8b949e' }, grid: { color: 'rgba(48,54,61,0.5)' } },
    },
  };

  // Monthly overview bar chart
  destroyChart('chart-monthly');
  charts['chart-monthly'] = new Chart(document.getElementById('chart-monthly'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Income', data: incomePerMonth, backgroundColor: chartColors.green, borderColor: chartColors.green, borderWidth: 1 },
        { label: 'Expenses', data: expensePerMonth, backgroundColor: chartColors.red, borderColor: chartColors.red, borderWidth: 1 },
      ],
    },
    options: defaultOpts,
  });

  // Expense breakdown pie
  const expenseCategories = {};
  appData.months.forEach(m => {
    m.expenses.forEach(e => {
      const k = e.description || 'Other';
      expenseCategories[k] = (expenseCategories[k] || 0) + (parseFloat(e.amount) || 0);
    });
  });
  destroyChart('chart-expenses-pie');
  charts['chart-expenses-pie'] = new Chart(document.getElementById('chart-expenses-pie'), {
    type: 'doughnut',
    data: {
      labels: Object.keys(expenseCategories),
      datasets: [{
        data: Object.values(expenseCategories),
        backgroundColor: chartColors.pieColors.slice(0, Object.keys(expenseCategories).length),
        borderColor: '#161b22',
        borderWidth: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'right', labels: { color: '#8b949e', font: { size: 11 }, padding: 12 } } },
    },
  });

  // Income breakdown pie
  const incomeCategories = {};
  appData.months.forEach(m => {
    m.incomings.forEach(inc => {
      const k = inc.description || 'Other';
      incomeCategories[k] = (incomeCategories[k] || 0) + (parseFloat(inc.amount) || 0);
    });
  });
  destroyChart('chart-income-pie');
  charts['chart-income-pie'] = new Chart(document.getElementById('chart-income-pie'), {
    type: 'doughnut',
    data: {
      labels: Object.keys(incomeCategories),
      datasets: [{
        data: Object.values(incomeCategories),
        backgroundColor: chartColors.pieColors.slice(0, Object.keys(incomeCategories).length),
        borderColor: '#161b22',
        borderWidth: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'right', labels: { color: '#8b949e', font: { size: 11 }, padding: 12 } } },
    },
  });

  // Net balance line chart
  destroyChart('chart-balance');
  charts['chart-balance'] = new Chart(document.getElementById('chart-balance'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Net Balance',
        data: balancePerMonth,
        borderColor: chartColors.blue,
        backgroundColor: chartColors.blueBg,
        fill: true,
        tension: 0.3,
        pointBackgroundColor: balancePerMonth.map(v => v >= 0 ? chartColors.green : chartColors.red),
        pointRadius: 6,
        pointHoverRadius: 8,
      }],
    },
    options: defaultOpts,
  });
}

function destroyChart(id) {
  if (charts[id]) {
    charts[id].destroy();
    delete charts[id];
  }
}

// ── Month Sections ─────────────────────────────────────────
function renderMonthSections() {
  const container = document.getElementById('month-sections');
  container.innerHTML = '';

  appData.months.forEach((month, mi) => {
    const totalExp = month.expenses.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
    const totalInc = month.incomings.reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);
    const net = totalInc - totalExp;
    const label = month.year ? `${month.name} ${month.year}` : month.name;

    const section = document.createElement('div');
    section.className = 'section';
    section.id = `section-month-${mi}`;

    section.innerHTML = `
      <div class="container">
        <div class="summary-row">
          <div class="summary-card">
            <div class="label">Income</div>
            <div class="value income">$${totalInc.toFixed(2)}</div>
          </div>
          <div class="summary-card">
            <div class="label">Expenses</div>
            <div class="value expense">$${totalExp.toFixed(2)}</div>
          </div>
          <div class="summary-card">
            <div class="label">Net</div>
            <div class="value ${net >= 0 ? 'positive' : 'negative'}">$${net.toFixed(2)}</div>
          </div>
        </div>
        <div class="month-grid">
          <div class="card">
            <div class="card-header">
              <h3>&#128308; Expenses</h3>
              <button class="btn btn-sm" onclick="addRow(${mi},'expenses')">+ Add</button>
            </div>
            <div class="table-wrapper">
              <table>
                <thead>
                  <tr><th>Description</th><th>Due Day</th><th>Amount</th><th></th></tr>
                </thead>
                <tbody id="expenses-body-${mi}">
                  ${month.expenses.map((e, ei) => expenseRow(mi, ei, e)).join('')}
                  <tr class="totals-row">
                    <td colspan="2"><strong>Total</strong></td>
                    <td class="amount-expense"><strong>$${totalExp.toFixed(2)}</strong></td>
                    <td></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <div class="card">
            <div class="card-header">
              <h3>&#128994; Incomings</h3>
              <button class="btn btn-sm" onclick="addRow(${mi},'incomings')">+ Add</button>
            </div>
            <div class="table-wrapper">
              <table>
                <thead>
                  <tr><th>Description</th><th>Due Day</th><th>Amount</th><th></th></tr>
                </thead>
                <tbody id="incomings-body-${mi}">
                  ${month.incomings.map((inc, ii) => incomeRow(mi, ii, inc)).join('')}
                  <tr class="totals-row">
                    <td colspan="2"><strong>Total</strong></td>
                    <td class="amount-income"><strong>$${totalInc.toFixed(2)}</strong></td>
                    <td></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <div style="margin-top:1rem;display:flex;gap:0.5rem;justify-content:flex-end;">
          <button class="btn btn-danger btn-sm" onclick="deleteMonth(${mi})">&#128465; Delete ${label}</button>
        </div>
      </div>
    `;

    container.appendChild(section);
  });
}

function expenseRow(mi, ei, e) {
  return `<tr>
    <td><input type="text" value="${escHtml(e.description)}" data-month="${mi}" data-type="expenses" data-idx="${ei}" data-field="description"></td>
    <td><input type="number" value="${e.due_day}" min="1" max="31" data-month="${mi}" data-type="expenses" data-idx="${ei}" data-field="due_day"></td>
    <td><input type="number" step="0.01" value="${e.amount}" data-month="${mi}" data-type="expenses" data-idx="${ei}" data-field="amount"></td>
    <td><button class="btn-icon btn-sm" title="Remove" onclick="removeRow(${mi},'expenses',${ei})">&#10060;</button></td>
  </tr>`;
}

function incomeRow(mi, ii, inc) {
  return `<tr>
    <td><input type="text" value="${escHtml(inc.description)}" data-month="${mi}" data-type="incomings" data-idx="${ii}" data-field="description"></td>
    <td><input type="number" value="${inc.due_day}" min="1" max="31" data-month="${mi}" data-type="incomings" data-idx="${ii}" data-field="due_day"></td>
    <td><input type="number" step="0.01" value="${inc.amount}" data-month="${mi}" data-type="incomings" data-idx="${ii}" data-field="amount"></td>
    <td><button class="btn-icon btn-sm" title="Remove" onclick="removeRow(${mi},'incomings',${ii})">&#10060;</button></td>
  </tr>`;
}

function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML.replace(/"/g, '&quot;');
}

// ── Editing ────────────────────────────────────────────────
function collectAllEdits() {
  document.querySelectorAll('input[data-month]').forEach(input => {
    const mi = parseInt(input.dataset.month);
    const type = input.dataset.type;
    const idx = parseInt(input.dataset.idx);
    const field = input.dataset.field;
    const month = appData.months[mi];
    if (!month) return;
    const arr = month[type];
    if (!arr || !arr[idx]) return;

    if (field === 'amount') {
      arr[idx][field] = parseFloat(input.value) || 0;
    } else if (field === 'due_day') {
      arr[idx][field] = parseInt(input.value) || 1;
    } else {
      arr[idx][field] = input.value;
    }
  });
}

function addRow(mi, type) {
  collectAllEdits();
  appData.months[mi][type].push({ description: '', due_day: 1, amount: 0 });
  renderAll();
}

function removeRow(mi, type, idx) {
  collectAllEdits();
  appData.months[mi][type].splice(idx, 1);
  renderAll();
}

function deleteMonth(mi) {
  const month = appData.months[mi];
  const label = month.year ? `${month.name} ${month.year}` : month.name;
  if (!confirm(`Delete "${label}"? This cannot be undone.`)) return;
  appData.months.splice(mi, 1);
  currentTab = 'dashboard';
  renderAll();
  showToast(`"${label}" deleted.`, 'info');
}

// ── Import ─────────────────────────────────────────────────
function openImportModal() {
  document.getElementById('import-modal').classList.add('active');
}

function closeImportModal() {
  document.getElementById('import-modal').classList.remove('active');
}

async function importFile() {
  const fileInput = document.getElementById('import-file');
  const yearInput = document.getElementById('import-year');

  if (!fileInput.files.length) {
    showToast('Please select a file.', 'error');
    return;
  }

  const file = fileInput.files[0];
  if (!file.name.toLowerCase().endsWith('.xlsx')) {
    showToast('Only .xlsx files are supported.', 'error');
    return;
  }

  const formData = new FormData();
  formData.append('file', file);

  const year = parseInt(yearInput.value) || 0;

  try {
    const res = await fetch(`/api/import?year=${year}`, {
      method: 'POST',
      body: formData,
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Import failed');

    showToast(`Imported ${result.imported_months} month(s): ${result.month_names.join(', ')}`, 'success');
    closeImportModal();
    fileInput.value = '';
    await loadData();
  } catch (err) {
    showToast('Import failed: ' + err.message, 'error');
  }
}

// ── Toast Notifications ────────────────────────────────────
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ── Init ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadData();
});
