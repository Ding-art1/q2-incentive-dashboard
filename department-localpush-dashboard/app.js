const payload = window.DASHBOARD_DATA;
const meta = payload.meta;
const records = payload.records;
const monthly = payload.monthly;
const C = Object.fromEntries(meta.columns.map((name, index) => [name, index]));
const M = Object.fromEntries(meta.monthlyColumns.map((name, index) => [name, index]));
const moneyFmt = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 });
const wanFmt = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 });
const pctFmt = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 });
const targetKey = "localpush-dashboard-targets-v1";
const businessTargetKey = "localpush-dashboard-business-targets-v1";
const opportunityStatusKey = "localpush-dashboard-opportunity-status-v1";
const opportunityStatusOptions = ["存量商机", "代充值新客户", "代充值新渠道", "代运营新客户", "每日新增"];
const bizCorrections = new Map([["悉美俪人", "代运营"]]);
const salesCorrections = new Map([["先行网络", "于泽"]]);
const palette = {
  blue: "#5277f6",
  green: "#1bbf8a",
  amber: "#f39a22",
  red: "#f25d5d",
  cyan: "#21b6c8",
  violet: "#7b61ff",
  grid: "rgba(117,131,154,.18)",
  tick: "#75839a"
};
const allLocalPushRows = records.filter(row => row[C["投流类别"]] === "本地推");
const firstLocalPushDate = new Map();
for (const row of allLocalPushRows) {
  const key = `${row[C["项目名称"]]}|${row[C["商机名称"]]}`;
  if (!firstLocalPushDate.has(key) || row[C.date] < firstLocalPushDate.get(key)) firstLocalPushDate.set(key, row[C.date]);
}
let charts = {};
let filtered = records;
let filteredMonthly = monthly;
let visualRows = allLocalPushRows;
let visualMonthly = monthly.filter(row => row[M["投流类别"]] === "本地推");
let activeTable = "monthly";
let sortState = { col: 0, dir: "asc" };
let currentPage = 1;
const pageSize = 50;
let pendingStatusOverrides = {};

function $(id) { return document.getElementById(id); }
function selected(id) { return Array.from($(id).selectedOptions).map(o => o.value); }
function dateObj(s) { return new Date(`${s}T00:00:00`); }
function dateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function sum(rows, idx) { return rows.reduce((acc, row) => acc + Number(row[idx] || 0), 0); }
function fmtMoney(v) { return moneyFmt.format(v || 0); }
function fmtWan(v) { return wanFmt.format((v || 0) / 10000); }
function fmtPct(actual, target) { return target ? `${pctFmt.format(actual / target * 100)}%` : "-"; }
function yuanToWanInput(v) { return v ? Number((Number(v) / 10000).toFixed(2)) : ""; }
function getTargets() { return JSON.parse(localStorage.getItem(targetKey) || "{}"); }
function setTargets(data) { localStorage.setItem(targetKey, JSON.stringify(data)); }
function getBusinessTargets() { return JSON.parse(localStorage.getItem(businessTargetKey) || "{}"); }
function setBusinessTargets(data) { localStorage.setItem(businessTargetKey, JSON.stringify(data)); }
function getStatusOverrides() { return JSON.parse(localStorage.getItem(opportunityStatusKey) || "{}"); }
function setStatusOverrides(data) { localStorage.setItem(opportunityStatusKey, JSON.stringify(data)); }
function escapeHtml(v) {
  return `${v ?? ""}`.replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function optionFill(id, values) {
  $(id).innerHTML = values.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");
}

function group(rows, keyFn, valIdx = C["非赠款消耗"]) {
  const out = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!key) continue;
    out.set(key, (out.get(key) || 0) + Number(row[valIdx] || 0));
  }
  return Array.from(out, ([label, value]) => ({ label, value })).sort((a, b) => `${a.label}`.localeCompare(`${b.label}`, "zh-CN"));
}

function groupedNew(monthRows, keyFn) {
  const out = new Map();
  for (const row of monthRows) {
    if (!isNewStatus(getMonthlyStatus(row))) continue;
    const key = keyFn(row);
    const id = `${row[M["项目名称"]]}|${row[M["包含商机"]]}`;
    if (!out.has(key)) out.set(key, new Set());
    out.get(key).add(id);
  }
  return Array.from(out, ([label, set]) => ({ label, value: set.size }));
}

function correctedDailyBiz(row) {
  return bizCorrections.get(row[C["项目名称"]]) || row[C["业务类型"]];
}

function correctedMonthlyBiz(row) {
  return bizCorrections.get(row[M["项目名称"]]) || row[M["业务类型"]];
}

function correctedDailySales(row) {
  return salesCorrections.get(row[C["项目名称"]]) || row[C["商务"]];
}

function correctedMonthlySales(row) {
  return salesCorrections.get(row[M["项目名称"]]) || row[M["商务"]];
}

function monthlyStatusId(row) {
  return [
    row[M.monthKey],
    row[M["项目名称"]],
    row[M["包含商机"]],
    row[M["投流类别"]],
    correctedMonthlyBiz(row),
    correctedMonthlySales(row),
    row[M["所属团队"]]
  ].join("|");
}

function normalizeStatus(status) {
  return opportunityStatusOptions.includes(status) ? status : "存量商机";
}

function getMonthlyStatus(row) {
  const overrides = getStatusOverrides();
  const id = monthlyStatusId(row);
  return normalizeStatus(pendingStatusOverrides[id] || overrides[id] || row[M["商机情况"]]);
}

function isNewStatus(status) {
  return status !== "存量商机";
}

function dateRange(start, end) {
  const days = [];
  const cursor = dateObj(start);
  const last = dateObj(end);
  while (cursor <= last) {
    days.push(dateStr(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function rowsByBiz(rows, biz) {
  return rows.filter(row => correctedDailyBiz(row) === biz);
}

function monthsInRange(start, end) {
  const months = [];
  const cursor = new Date(`${start.slice(0, 7)}-01T00:00:00`);
  const last = new Date(`${end.slice(0, 7)}-01T00:00:00`);
  while (cursor <= last) {
    months.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return months;
}

function targetRowsFor(months, rows) {
  const targets = getTargets();
  const actualKeys = new Set(rows.map(row => `${row[M["所属团队"]]}|${correctedMonthlySales(row)}`));
  const out = [];
  for (const key of Object.keys(targets)) {
    const [month, team, sales] = key.split("|");
    if (months.includes(month) && actualKeys.has(`${team}|${sales}`)) {
      out.push({ month, team, sales, spend: Number(targets[key].spend || 0), fresh: Number(targets[key].fresh || 0) });
    }
  }
  return out;
}

function businessTargetFor(months, biz) {
  const targets = getBusinessTargets();
  return months.reduce((acc, month) => acc + Number(targets[`${month}|${biz}`] || 0), 0);
}

const valueLabelPlugin = {
  id: "valueLabels",
  afterDatasetsDraw(chart, _args, pluginOptions) {
    const { ctx, data, chartArea } = chart;
    ctx.save();
    ctx.fillStyle = pluginOptions.color || palette.tick;
    ctx.font = pluginOptions.font || "700 12px -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    data.datasets.forEach((dataset, datasetIndex) => {
      const meta = chart.getDatasetMeta(datasetIndex);
      if (meta.hidden) return;
      meta.data.forEach((bar, index) => {
        const value = Number(dataset.data[index] || 0);
        if (!Number.isFinite(value)) return;
        const point = bar.tooltipPosition();
        const text = pluginOptions.kind === "percent" ? `${pctFmt.format(value)}%` : `${fmtWan(value)}万`;
        ctx.fillText(text, Math.min(point.x + 8, chartArea.right + 40), point.y);
      });
    });
    ctx.restore();
  }
};

function chart(id, type, labels, datasets, options = {}) {
  if (charts[id]) charts[id].destroy();
  const { showValueLabels, valueLabelKind, valueLabelColor, ...chartOptions } = options;
  const isCount = chartOptions.countAxis;
  const horizontal = chartOptions.indexAxis === "y";
  const basePlugins = {
    legend: { display: datasets.length > 1 },
    tooltip: {
      callbacks: {
        label(ctx) {
          const label = ctx.dataset.label ? `${ctx.dataset.label}: ` : "";
          if (type === "doughnut") {
            const value = Number(ctx.parsed || 0);
            const total = (ctx.dataset.data || []).reduce((acc, item) => acc + Number(item || 0), 0);
            const share = total ? value / total * 100 : 0;
            return `${label}${fmtWan(value)}万｜占比 ${pctFmt.format(share)}%`;
          }
          const value = horizontal ? ctx.parsed.x : (ctx.parsed.y ?? ctx.parsed.x ?? ctx.parsed);
          return isCount ? `${label}${fmtMoney(value)}` : `${label}${fmtWan(value)}万`;
        }
      }
    },
    ...(chartOptions.plugins || {})
  };
  if (showValueLabels) {
    basePlugins.valueLabels = {
      kind: valueLabelKind || "money",
      color: valueLabelColor || palette.tick
    };
  }
  const layout = showValueLabels
    ? { ...(chartOptions.layout || {}), padding: { ...((chartOptions.layout || {}).padding || {}), right: 58 } }
    : chartOptions.layout;
  charts[id] = new Chart($(id), {
    type,
    data: { labels, datasets },
    plugins: showValueLabels ? [valueLabelPlugin] : [],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: basePlugins,
      layout,
      scales: type === "doughnut" ? {} : horizontal ? {
        x: { beginAtZero: true, grid: { color: palette.grid }, ticks: { color: palette.tick, callback: v => isCount ? fmtMoney(v) : `${fmtWan(v)}万` } },
        y: { grid: { color: palette.grid }, ticks: { color: palette.tick, autoSkip: false } }
      } : {
        y: { beginAtZero: true, grid: { color: palette.grid }, ticks: { color: palette.tick, callback: v => isCount ? fmtMoney(v) : `${fmtWan(v)}万` } },
        x: { grid: { color: palette.grid }, ticks: { color: palette.tick, maxRotation: 35, minRotation: 0 } }
      },
      ...chartOptions,
      plugins: basePlugins,
      layout
    }
  });
}

function metric(title, value, sub = "", tone = "") {
  return `<article class="metric ${escapeHtml(tone)}"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(title)}</span>${sub ? `<em>${escapeHtml(sub)}</em>` : ""}</article>`;
}

function renderMetricGrid(id, items) {
  $(id).innerHTML = items.join("");
}

function bulletin(title, headline, detail, tone = "") {
  return `<article class="bulletinCard ${escapeHtml(tone)}"><span>${escapeHtml(title)}</span><strong>${escapeHtml(headline)}</strong><p>${escapeHtml(detail)}</p></article>`;
}

function renderList(id, items, empty) {
  $(id).innerHTML = items.length
    ? `<ul>${items.map(item => `<li>${item}</li>`).join("")}</ul>`
    : `<p>${escapeHtml(empty)}</p>`;
}

function startOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay() || 7;
  d.setDate(d.getDate() - day + 1);
  return d;
}

function weekKey(dateText) {
  const start = startOfWeek(dateObj(dateText));
  return dateStr(start);
}

function monthWeekKey(dateText) {
  const day = Number(dateText.slice(8, 10));
  return `week${Math.floor((day - 1) / 7) + 1}`;
}

function previousDateText(dateText, days = 1) {
  const d = dateObj(dateText);
  d.setDate(d.getDate() - days);
  return dateStr(d);
}

function compareLabel(current, previous) {
  if (!previous) return "环比 -";
  const delta = (current - previous) / previous * 100;
  const sign = delta > 0 ? "+" : "";
  return `环比 ${sign}${pctFmt.format(delta)}%`;
}

function realPreviousDay() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d;
}

function computePeriodDates() {
  const mode = $("periodMode").value;
  const year = $("yearFilter").value || meta.dateMax.slice(0, 4);
  if (mode === "year") return [`${year}-01-01`, `${year}-12-31`];
  if (mode === "quarter") {
    const q = Number(($("quarterQuick").value || "Q1").replace("Q", ""));
    const startMonth = (q - 1) * 3;
    const start = new Date(Number(year), startMonth, 1);
    const end = new Date(Number(year), startMonth + 3, 0);
    return [dateStr(start), dateStr(end)];
  }
  if (mode === "month") {
    const month = $("monthQuick").value || meta.dateMax.slice(0, 7);
    const [y, m] = month.split("-").map(Number);
    return [`${month}-01`, dateStr(new Date(y, m, 0))];
  }
  return [$("startDate").value || meta.dateMin, $("endDate").value || meta.dateMax];
}

function syncDateInputs() {
  if ($("periodMode").value === "custom") return;
  const [start, end] = computePeriodDates();
  $("startDate").value = start < meta.dateMin ? meta.dateMin : start;
  $("endDate").value = end > meta.dateMax ? meta.dateMax : end;
}

function syncFilterControls() {
  const mode = $("periodMode").value;
  const custom = mode === "custom";
  $("yearFilterWrap").hidden = !["year", "quarter", "month"].includes(mode);
  $("quarterFilterWrap").hidden = mode !== "quarter";
  $("monthFilterWrap").hidden = mode !== "month";
  $("startDateWrap").hidden = mode !== "custom";
  $("endDateWrap").hidden = mode !== "custom";
  $("startDate").disabled = !custom;
  $("endDate").disabled = !custom;
  syncDateInputs();
}

function applyFilters() {
  syncDateInputs();
  const start = $("startDate").value || meta.dateMin;
  const end = $("endDate").value || meta.dateMax;
  const categories = selected("categoryFilter");
  const biz = selected("bizFilter");
  const teams = selected("teamFilter");
  const sales = selected("salesFilter");
  const projects = selected("projectFilter");
  const commonDaily = row => row[C.date] >= start && row[C.date] <= end
    && (!biz.length || biz.includes(correctedDailyBiz(row)))
    && (!teams.length || teams.includes(row[C["所属团队"]]))
    && (!sales.length || sales.includes(correctedDailySales(row)))
    && (!projects.length || projects.includes(row[C["项目名称"]]));
  const commonMonthly = row => row[M.monthKey] >= start.slice(0, 7) && row[M.monthKey] <= end.slice(0, 7)
    && (!biz.length || biz.includes(correctedMonthlyBiz(row)))
    && (!teams.length || teams.includes(row[M["所属团队"]]))
    && (!sales.length || sales.includes(correctedMonthlySales(row)))
    && (!projects.length || projects.includes(row[M["项目名称"]]));

  filtered = records.filter(row => commonDaily(row) && (!categories.length || categories.includes(row[C["投流类别"]])));
  filteredMonthly = monthly.filter(row => commonMonthly(row) && (!categories.length || categories.includes(row[M["投流类别"]])));
  visualRows = records.filter(row => commonDaily(row) && row[C["投流类别"]] === "本地推");
  visualMonthly = monthly.filter(row => commonMonthly(row) && row[M["投流类别"]] === "本地推");
  currentPage = 1;
  renderAll();
}

function renderTime() {
  const maxDate = realPreviousDay();
  const y = maxDate.getFullYear();
  const m = maxDate.getMonth();
  const monthStart = new Date(y, m, 1);
  const monthEnd = new Date(y, m + 1, 0);
  const qStartMonth = Math.floor(m / 3) * 3;
  const qStart = new Date(y, qStartMonth, 1);
  const qEnd = new Date(y, qStartMonth + 3, 0);
  const dayMs = 86400000;
  const elapsedMonthDays = Math.max(0, Math.min(monthEnd.getDate(), maxDate.getDate()));
  const elapsedQuarterDays = Math.max(0, Math.floor((maxDate - qStart) / dayMs) + 1);
  const totalQuarterDays = Math.floor((qEnd - qStart) / dayMs) + 1;
  $("monthProgress").textContent = `${pctFmt.format(elapsedMonthDays / monthEnd.getDate() * 100)}%`;
  $("quarterProgress").textContent = `${pctFmt.format(elapsedQuarterDays / totalQuarterDays * 100)}%`;
  $("monthCountdown").textContent = `${Math.max(0, Math.ceil((monthEnd - maxDate) / dayMs))}天`;
  $("quarterCountdown").textContent = `${Math.max(0, Math.ceil((qEnd - maxDate) / dayMs))}天`;
}

function latestDate(rows) {
  return rows.reduce((max, row) => row[C.date] > max ? row[C.date] : max, "");
}

function renderOverview() {
  const start = $("startDate").value || meta.dateMin;
  const end = $("endDate").value || meta.dateMax;
  const months = monthsInRange(start, end);
  const yesterday = latestDate(visualRows) || end;
  const prevDay = previousDateText(yesterday);
  const yesterdayRows = visualRows.filter(row => row[C.date] === yesterday);
  const prevDayRows = visualRows.filter(row => row[C.date] === prevDay);
  const weekStart = dateStr(startOfWeek(dateObj(yesterday)));
  const prevWeekStart = previousDateText(weekStart, 7);
  const prevWeekEnd = previousDateText(weekStart, 1);
  const weekRows = visualRows.filter(row => row[C.date] >= weekStart && row[C.date] <= yesterday);
  const prevWeekRows = visualRows.filter(row => row[C.date] >= prevWeekStart && row[C.date] <= prevWeekEnd);
  const rechargeRows = rowsByBiz(visualRows, "代充值");
  const operateRows = rowsByBiz(visualRows, "代运营");
  const yesterdayRecharge = rowsByBiz(yesterdayRows, "代充值");
  const yesterdayOperate = rowsByBiz(yesterdayRows, "代运营");
  const prevDayRecharge = rowsByBiz(prevDayRows, "代充值");
  const prevDayOperate = rowsByBiz(prevDayRows, "代运营");
  const weekRecharge = rowsByBiz(weekRows, "代充值");
  const weekOperate = rowsByBiz(weekRows, "代运营");
  const prevWeekRecharge = rowsByBiz(prevWeekRows, "代充值");
  const prevWeekOperate = rowsByBiz(prevWeekRows, "代运营");
  const targetRows = targetRowsFor(months, visualMonthly);
  const rechargeBizTarget = businessTargetFor(months, "代充值");
  const operateBizTarget = businessTargetFor(months, "代运营");
  const totalTarget = rechargeBizTarget + operateBizTarget;
  const totalNewTarget = targetRows.reduce((acc, row) => acc + row.fresh, 0);
  const localSpend = sum(visualRows, C["非赠款消耗"]);
  const rechargeSpend = sum(rechargeRows, C["非赠款消耗"]);
  const operateSpend = sum(operateRows, C["非赠款消耗"]);
  const newOpportunityParts = {
    rechargeCustomer: groupedNew(visualMonthly.filter(row => getMonthlyStatus(row) === "代充值新客户"), r => "all").find(x => x.label === "all")?.value || 0,
    operateCustomer: groupedNew(visualMonthly.filter(row => getMonthlyStatus(row) === "代运营新客户"), r => "all").find(x => x.label === "all")?.value || 0,
    rechargeChannel: groupedNew(visualMonthly.filter(row => getMonthlyStatus(row) === "代充值新渠道"), r => "all").find(x => x.label === "all")?.value || 0
  };
  const newOpportunityCount = newOpportunityParts.rechargeCustomer + newOpportunityParts.operateCustomer + newOpportunityParts.rechargeChannel;

  if ($("kpiLocalPush")) $("kpiLocalPush").textContent = fmtWan(localSpend);
  if ($("kpiRecharge")) $("kpiRecharge").textContent = fmtWan(rechargeSpend);
  if ($("kpiOperate")) $("kpiOperate").textContent = fmtWan(operateSpend);
  if ($("kpiNew")) $("kpiNew").textContent = fmtMoney(newOpportunityCount);

  renderMetricGrid("totalMetrics", [
    metric("本地推实绩", `${fmtWan(localSpend)}万`, `目标 ${fmtWan(totalTarget)}万｜达成 ${fmtPct(localSpend, totalTarget)}`, "biz-local"),
    metric("代充值实绩", `${fmtWan(rechargeSpend)}万`, `目标 ${fmtWan(rechargeBizTarget)}万｜达成 ${fmtPct(rechargeSpend, rechargeBizTarget)}`, "biz-recharge"),
    metric("代运营实绩", `${fmtWan(operateSpend)}万`, `目标 ${fmtWan(operateBizTarget)}万｜达成 ${fmtPct(operateSpend, operateBizTarget)}`, "biz-operate"),
    metric("新增商机", `${fmtMoney(newOpportunityCount)}`, `代充值新客户 ${fmtMoney(newOpportunityParts.rechargeCustomer)}｜代运营新客户 ${fmtMoney(newOpportunityParts.operateCustomer)}｜代充值新渠道 ${fmtMoney(newOpportunityParts.rechargeChannel)}`, "biz-new")
  ]);
  const topTeam = group(visualRows, row => row[C["所属团队"]]).sort((a, b) => b.value - a.value)[0];
  const topSales = group(visualRows, correctedDailySales).sort((a, b) => b.value - a.value)[0];
  const rechargeShare = localSpend ? rechargeSpend / localSpend * 100 : 0;
  const operateShare = localSpend ? operateSpend / localSpend * 100 : 0;
  $( "performanceBulletins").innerHTML = [
    bulletin("周期目标达成", `${fmtPct(localSpend, totalTarget)}`, `本地推 ${fmtWan(localSpend)}万｜目标 ${fmtWan(totalTarget)}万`, "biz-local"),
    bulletin("业务贡献", `代充值 ${pctFmt.format(rechargeShare)}%`, `代充值 ${fmtWan(rechargeSpend)}万｜代运营 ${fmtWan(operateSpend)}万，占比 ${pctFmt.format(operateShare)}%`, "biz-recharge"),
    bulletin("团队/商务领跑", topSales ? `${topSales.label} ${fmtWan(topSales.value)}万` : "暂无数据", topTeam ? `${topTeam.label} ${fmtWan(topTeam.value)}万` : "当前周期暂无团队数据", "biz-operate"),
    bulletin("新增商机", `${fmtMoney(newOpportunityCount)} 个`, `代充新客 ${fmtMoney(newOpportunityParts.rechargeCustomer)}｜代运新客 ${fmtMoney(newOpportunityParts.operateCustomer)}｜代充新渠道 ${fmtMoney(newOpportunityParts.rechargeChannel)}`, "biz-new")
  ].join("");

  renderMetricGrid("dailyMetrics", [
    metric("本地推昨日消耗", `${fmtWan(sum(yesterdayRows, C["非赠款消耗"]))}万`, `${yesterday}｜${compareLabel(sum(yesterdayRows, C["非赠款消耗"]), sum(prevDayRows, C["非赠款消耗"]))}`, "biz-local"),
    metric("代充值昨日消耗", `${fmtWan(sum(yesterdayRecharge, C["非赠款消耗"]))}万`, `${yesterday}｜${compareLabel(sum(yesterdayRecharge, C["非赠款消耗"]), sum(prevDayRecharge, C["非赠款消耗"]))}`, "biz-recharge"),
    metric("代运营昨日消耗", `${fmtWan(sum(yesterdayOperate, C["非赠款消耗"]))}万`, `${yesterday}｜${compareLabel(sum(yesterdayOperate, C["非赠款消耗"]), sum(prevDayOperate, C["非赠款消耗"]))}`, "biz-operate")
  ]);
  const dailyLocal = group(visualRows, r => r[C.date]);
  const dailyRecharge = group(rechargeRows, r => r[C.date]);
  const dailyOperate = group(operateRows, r => r[C.date]);
  const dailyLabels = Array.from(new Set([...dailyLocal, ...dailyRecharge, ...dailyOperate].map(x => x.label))).sort();
  chart("dailyTrend", "line", dailyLabels, [
    { label: "本地推", data: dailyLabels.map(d => dailyLocal.find(x => x.label === d)?.value || 0), borderColor: palette.blue, backgroundColor: "rgba(82,119,246,.14)", tension: .25 },
    { label: "代充值", data: dailyLabels.map(d => dailyRecharge.find(x => x.label === d)?.value || 0), borderColor: palette.green, backgroundColor: "rgba(27,191,138,.14)", tension: .25 },
    { label: "代运营", data: dailyLabels.map(d => dailyOperate.find(x => x.label === d)?.value || 0), borderColor: palette.amber, backgroundColor: "rgba(243,154,34,.14)", tension: .25 }
  ]);
  const yProjects = group(yesterdayRows, r => r[C["项目名称"]]).sort((a, b) => b.value - a.value).slice(0, 10);
  renderRankList("yesterdayProjectRank", yProjects);

  renderMetricGrid("weeklyMetrics", [
    metric("本地推本周消耗", `${fmtWan(sum(weekRows, C["非赠款消耗"]))}万`, `${weekStart} 至 ${yesterday}｜${compareLabel(sum(weekRows, C["非赠款消耗"]), sum(prevWeekRows, C["非赠款消耗"]))}`, "biz-local"),
    metric("代充值本周消耗", `${fmtWan(sum(weekRecharge, C["非赠款消耗"]))}万`, compareLabel(sum(weekRecharge, C["非赠款消耗"]), sum(prevWeekRecharge, C["非赠款消耗"])), "biz-recharge"),
    metric("代运营本周消耗", `${fmtWan(sum(weekOperate, C["非赠款消耗"]))}万`, compareLabel(sum(weekOperate, C["非赠款消耗"]), sum(prevWeekOperate, C["非赠款消耗"])), "biz-operate")
  ]);
  const currentMonth = end.slice(0, 7);
  const monthRows = visualRows.filter(row => row[C.date].startsWith(currentMonth));
  const monthRechargeRows = rechargeRows.filter(row => row[C.date].startsWith(currentMonth));
  const monthOperateRows = operateRows.filter(row => row[C.date].startsWith(currentMonth));
  const weekLabels = ["week1", "week2", "week3", "week4", "week5"];
  const weekLocal = group(monthRows, r => monthWeekKey(r[C.date]));
  const weekRechargeSeries = group(monthRechargeRows, r => monthWeekKey(r[C.date]));
  const weekOperateSeries = group(monthOperateRows, r => monthWeekKey(r[C.date]));
  chart("weeklyLocalTrend", "bar", weekLabels, [{ label: "本地推", data: weekLabels.map(d => weekLocal.find(x => x.label === d)?.value || 0), backgroundColor: palette.blue }]);
  chart("weeklyRechargeTrend", "bar", weekLabels, [{ label: "代充值", data: weekLabels.map(d => weekRechargeSeries.find(x => x.label === d)?.value || 0), backgroundColor: palette.green }]);
  chart("weeklyOperateTrend", "bar", weekLabels, [{ label: "代运营", data: weekLabels.map(d => weekOperateSeries.find(x => x.label === d)?.value || 0), backgroundColor: palette.amber }]);

  const operateMonthly = visualMonthly.filter(row => correctedMonthlyBiz(row) === "代运营");
  const operateTarget = operateBizTarget;
  const operatePct = operateTarget ? operateSpend / operateTarget * 100 : 0;
  renderMetricGrid("operateMetrics", [
    metric("代运营昨日消耗", `${fmtWan(sum(yesterdayOperate, C["非赠款消耗"]))}万`, yesterday, "biz-operate"),
    metric("代运营周期实绩", `${fmtWan(operateSpend)}万`, `目标 ${fmtWan(operateTarget)}万｜达成 ${fmtPct(operateSpend, operateTarget)}`, "biz-operate"),
    `<article class="metric biz-operate targetMiniCard"><strong id="operateTargetPct">${operateTarget ? `${pctFmt.format(operatePct)}%` : "-"}</strong><span>代运营目标达成进度</span><div class="miniProgress"><span style="width:${Math.max(0, Math.min(100, operatePct || 0))}%"></span></div><em>当前 ${fmtWan(operateSpend)}万｜目标 ${fmtWan(operateTarget)}万</em></article>`
  ]);
  renderOperateProjectCards(monthOperateRows);

  const teamRechargeDaily = ["销售一组", "销售二组"].map((team, i) => {
    const series = group(rechargeRows.filter(row => row[C["所属团队"]] === team), r => r[C.date]);
    return { team, series, color: i ? palette.amber : palette.blue };
  });
  renderMetricGrid("rechargeMetrics", [
    metric("销售一组昨日本地推消耗", `${fmtWan(sum(yesterdayRows.filter(row => row[C["所属团队"]] === "销售一组"), C["非赠款消耗"]))}万`, "", "team-one"),
    metric("销售二组昨日本地推消耗", `${fmtWan(sum(yesterdayRows.filter(row => row[C["所属团队"]] === "销售二组"), C["非赠款消耗"]))}万`, "", "team-two"),
    metric("代充值昨日消耗", `${fmtWan(sum(yesterdayRecharge, C["非赠款消耗"]))}万`, yesterday, "biz-recharge"),
    metric("代充值本周消耗", `${fmtWan(sum(weekRecharge, C["非赠款消耗"]))}万`, "", "biz-recharge")
  ]);
  const rechargeLabels = Array.from(new Set(teamRechargeDaily.flatMap(x => x.series.map(s => s.label)))).sort();
  chart("rechargeTeamDailyChart", "line", rechargeLabels, teamRechargeDaily.map(x => ({
    label: x.team,
    data: rechargeLabels.map(d => x.series.find(s => s.label === d)?.value || 0),
    borderColor: x.color,
    backgroundColor: `${x.color}22`,
    tension: .25
  })));
  renderTargetCharts(months, rechargeRows);

  const portSeries = ["深圳端口", "海南端口"].map((port, i) => {
    const series = group(visualRows.filter(row => row[C["端口"]] === port), r => r[C.date]);
    return { port, series, color: i ? palette.amber : palette.blue };
  });
  const portLabels = Array.from(new Set(portSeries.flatMap(x => x.series.map(s => s.label)))).sort();
  chart("portDailyChart", "line", portLabels, portSeries.map(x => ({
    label: x.port,
    data: portLabels.map(d => x.series.find(s => s.label === d)?.value || 0),
    borderColor: x.color,
    backgroundColor: `${x.color}22`,
    tension: .25
  })));
  const portShare = group(visualRows, r => r[C["端口"]]);
  chart("portShareChart", "doughnut", portShare.map(x => x.label), [{ data: portShare.map(x => x.value), backgroundColor: [palette.blue, palette.amber, palette.green, palette.red] }]);
}

function renderProjectLines(id, rows, labelPrefix, limit = 8) {
  const topProjects = group(rows, r => r[C["项目名称"]]).sort((a, b) => b.value - a.value).slice(0, limit).map(x => x.label);
  const labels = group(rows, r => r[C.date]).map(x => x.label);
  const colors = [palette.blue, palette.green, palette.amber, palette.red, palette.violet, palette.cyan, "#8a97ad", "#d4822d"];
  const datasets = topProjects.map((project, i) => {
    const series = group(rows.filter(row => row[C["项目名称"]] === project), r => r[C.date]);
    return {
      label: project || `${labelPrefix}${i + 1}`,
      data: labels.map(d => series.find(x => x.label === d)?.value || 0),
      borderColor: colors[i % colors.length],
      backgroundColor: `${colors[i % colors.length]}22`,
      tension: .25
    };
  });
  chart(id, "line", labels, datasets.length ? datasets : [{ label: labelPrefix, data: [], borderColor: palette.blue }]);
}

function renderRankList(id, rows) {
  const box = $(id);
  if (!box) return;
  if (!rows.length) {
    box.innerHTML = `<div class="emptyTrend">当前暂无数据</div>`;
    return;
  }
  const max = Math.max(...rows.map(row => row.value), 1);
  box.innerHTML = rows.map((row, index) => `
    <div class="rankRow">
      <span class="rankNo">${index + 1}</span>
      <span class="rankName" title="${escapeHtml(row.label)}">${escapeHtml(row.label)}</span>
      <div class="rankBarTrack"><span style="width:${Math.max(2, row.value / max * 100)}%"></span></div>
      <strong>${fmtWan(row.value)}万</strong>
    </div>
  `).join("");
}

function renderMonthlyNewOpportunityList(month) {
  const box = $("monthlyNewOpportunityList");
  if (!box) return;
  const newStatuses = new Set(["代充值新客户", "代运营新客户", "代充值新渠道"]);
  const rows = mergedMonthlyRows(visualMonthly)
    .filter(row => row[M.monthKey] === month && newStatuses.has(getMonthlyStatus(row)))
    .sort((a, b) => Number(b[M["非赠款消耗"]] || 0) - Number(a[M["非赠款消耗"]] || 0));
  if (!rows.length) {
    box.innerHTML = `<div class="emptyTrend">本月暂无新增商机</div>`;
    return;
  }
  box.innerHTML = `<table><thead><tr><th>归属类别</th><th>项目名称</th><th>商务</th><th class="num">非赠款消耗</th></tr></thead><tbody>${rows.map(row => `
    <tr>
      <td>${escapeHtml(getMonthlyStatus(row))}</td>
      <td>${escapeHtml(row[M["项目名称"]])}</td>
      <td>${escapeHtml(correctedMonthlySales(row))}</td>
      <td class="num">${fmtWan(row[M["非赠款消耗"]])}万</td>
    </tr>
  `).join("")}</tbody></table>`;
}

function renderOperateProjectCards(rows) {
  const grid = $("operateProjectDailyGrid");
  if (!grid) return;
  for (const key of Object.keys(charts)) {
    if (key.startsWith("operateProjectCard_")) {
      charts[key].destroy();
      delete charts[key];
    }
  }
  const topProjects = group(rows, r => r[C["项目名称"]]).sort((a, b) => b.value - a.value).slice(0, 8).map(x => x.label);
  if (!topProjects.length) {
    grid.innerHTML = `<div class="emptyTrend">当前暂无数据</div>`;
    return;
  }
  grid.innerHTML = topProjects.map((project, index) => `
    <article class="projectTrendCard">
      <h3>${escapeHtml(project)}日耗趋势</h3>
      <canvas id="operateProjectCard_${index}"></canvas>
    </article>
  `).join("");
  const allDates = group(rows, r => r[C.date]).map(x => x.label);
  topProjects.forEach((project, index) => {
    const series = group(rows.filter(row => row[C["项目名称"]] === project), r => r[C.date]);
    chart(`operateProjectCard_${index}`, "line", allDates, [{
      label: project,
      data: allDates.map(date => series.find(x => x.label === date)?.value || 0),
      borderColor: palette.blue,
      backgroundColor: "rgba(82,119,246,.14)",
      tension: .35
    }], {
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => `${fmtWan(ctx.parsed.y)}万` } }
      },
      scales: {
        y: { beginAtZero: true, ticks: { callback: v => `${fmtWan(v)}万` } },
        x: { ticks: { maxRotation: 60, minRotation: 45 } }
      }
    });
  });
}

function renderTargetCharts(months, rechargeRows) {
  const rechargeMonthly = visualMonthly.filter(row => correctedMonthlyBiz(row) === "代充值");
  renderMonthlyNewOpportunityList(($("endDate").value || meta.dateMax).slice(0, 7));
  const targetRows = targetRowsFor(months, rechargeMonthly);
  const actualByGroup = group(rechargeRows, row => row[C["所属团队"]]);
  const targetByGroup = new Map();
  for (const row of targetRows) {
    targetByGroup.set(row.team, (targetByGroup.get(row.team) || 0) + row.spend);
  }
  const groupLabels = Array.from(new Set([...actualByGroup.map(x => x.label), ...targetByGroup.keys()])).sort((a, b) => a.localeCompare(b, "zh-CN"));
  chart("rechargeGroupTargetChart", "bar", groupLabels, [
    { label: "实际消耗", data: groupLabels.map(l => actualByGroup.find(x => x.label === l)?.value || 0), backgroundColor: palette.blue },
    { label: "消耗目标", data: groupLabels.map(l => targetByGroup.get(l) || 0), backgroundColor: palette.amber }
  ], { indexAxis: "y" });

  const actualByPerson = group(rechargeRows, row => `${row[C["所属团队"]]}-${correctedDailySales(row)}`);
  const targetByPerson = new Map();
  for (const row of targetRows) {
    const key = `${row.team}-${row.sales}`;
    targetByPerson.set(key, (targetByPerson.get(key) || 0) + row.spend);
  }
  const labels = Array.from(new Set([...actualByPerson.map(x => x.label), ...targetByPerson.keys()])).sort((a, b) => a.localeCompare(b, "zh-CN"));
  chart("rechargePersonTargetChart", "bar", labels, [
    { label: "实际消耗", data: labels.map(l => actualByPerson.find(x => x.label === l)?.value || 0), backgroundColor: palette.blue },
    { label: "消耗目标", data: labels.map(l => targetByPerson.get(l) || 0), backgroundColor: palette.amber }
  ], { indexAxis: "y" });

  const completionLabels = months;
  const completionData = completionLabels.map(month => {
    const monthRows = rechargeMonthly.filter(row => row[M.monthKey] === month);
    const actual = sum(monthRows, M["非赠款消耗"]);
    const target = targetRowsFor([month], monthRows).reduce((acc, row) => acc + row.spend, 0);
    return target ? actual / target * 100 : 0;
  });
  chart("rechargeCompletionChart", "line", completionLabels, [{
    label: "完成率",
    data: completionData,
    borderColor: palette.violet,
    backgroundColor: "rgba(123,97,255,.14)",
    tension: .25
  }], {
    countAxis: true,
    scales: {
      y: { beginAtZero: true, ticks: { callback: v => `${v}%` } },
      x: { ticks: { maxRotation: 35, minRotation: 0 } }
    },
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: ctx => `完成率: ${pctFmt.format(ctx.parsed.y)}%` } }
    }
  });

  const newActual = groupedNew(rechargeMonthly, row => `${row[M["所属团队"]]}-${correctedMonthlySales(row)}`);
  const newTarget = new Map();
  for (const row of targetRows) {
    const key = `${row.team}-${row.sales}`;
    newTarget.set(key, (newTarget.get(key) || 0) + row.fresh);
  }
  const newLabels = Array.from(new Set([...newActual.map(x => x.label), ...newTarget.keys()])).sort((a, b) => a.localeCompare(b, "zh-CN"));
  chart("rechargeNewChart", "bar", newLabels, [
    { label: "实际新开", data: newLabels.map(l => newActual.find(x => x.label === l)?.value || 0), backgroundColor: palette.green },
    { label: "新开目标", data: newLabels.map(l => newTarget.get(l) || 0), backgroundColor: palette.red }
  ], { indexAxis: "y", countAxis: true });
}

function renderWarnings(yesterday) {
  const start = $("startDate").value || meta.dateMin;
  const end = $("endDate").value || meta.dateMax;
  const days = dateRange(start, end);
  const byProject = new Map();
  for (const row of visualRows) {
    const project = row[C["项目名称"]];
    const date = row[C.date];
    if (!byProject.has(project)) byProject.set(project, new Map());
    const dateMap = byProject.get(project);
    dateMap.set(date, (dateMap.get(date) || 0) + Number(row[C["非赠款消耗"]] || 0));
  }
  const items = [];
  for (const [project, dateMap] of byProject.entries()) {
    const ySpend = dateMap.get(yesterday) || 0;
    const prevDates = Array.from(dateMap.keys()).filter(date => date < yesterday && (dateMap.get(date) || 0) > 0).sort((a, b) => b.localeCompare(a)).slice(0, 7);
    const avg = prevDates.length ? prevDates.reduce((acc, d) => acc + (dateMap.get(d) || 0), 0) / prevDates.length : 0;
    if (avg >= 10000 && ySpend < avg * 0.5) {
      items.push(`<strong>${escapeHtml(project)}</strong> 昨日 ${fmtWan(ySpend)}万，低于近7个有消耗日均值 ${fmtWan(avg)}万`);
    }
    const noSpendDays = days.filter(day => (dateMap.get(day) || 0) <= 0);
    if (noSpendDays.length >= 3) {
      const sample = noSpendDays.slice(-3).join("、");
      items.push(`<strong>${escapeHtml(project)}</strong> 当前周期累计 ${noSpendDays.length} 天无消耗，最近无消耗日：${sample}`);
    }
  }
  items.sort((a, b) => b.localeCompare(a, "zh-CN"));
  renderList("warningList", items.slice(0, 12), "当前筛选周期内暂无明显异常项目。");
}

function renderGoodNews(yesterday, yesterdayRows, rows) {
  const items = [];
  for (const itemDef of [{ label: "个人", key: correctedDailySales }, { label: "各组", key: r => r[C["所属团队"]] }, { label: "各业务", key: correctedDailyBiz }]) {
    const today = group(yesterdayRows, itemDef.key);
    for (const item of today) {
      const history = group(rows.filter(row => row[C.date] < yesterday && itemDef.key(row) === item.label), r => r[C.date]);
      const maxHistory = Math.max(0, ...history.map(x => x.value));
      if (item.value > 0 && item.value > maxHistory) {
        items.push(`${itemDef.label} <strong>${escapeHtml(item.label)}</strong> 昨日 ${fmtWan(item.value)}万，突破历史单日记录 ${fmtWan(maxHistory)}万`);
      }
    }
  }
  const statusRows = visualMonthly
    .filter(row => isNewStatus(getMonthlyStatus(row)))
    .slice(0, 10)
    .map(row => {
      const status = getMonthlyStatus(row);
      const label = status === "代充值新渠道" ? "昨日新增渠道" : status === "每日新增" ? "每日新增" : "昨日新增直客";
      return `${label}：<strong>${escapeHtml(row[M["项目名称"]])}</strong> / ${escapeHtml(row[M["包含商机"]])}（${escapeHtml(status)}）`;
    });
  renderList("goodNewsList", [...items.slice(0, 10), ...statusRows], "当前筛选周期内暂无突破记录或新增直客/渠道。");
}

function mergedMonthlyRows(rows) {
  const numericNames = new Set(["总消耗", "非赠款消耗", "赠款消耗"]);
  const statusIndex = M["商机情况"];
  const bizIndex = M["业务类型"];
  const salesIndex = M["商务"];
  const groups = new Map();
  for (const row of rows) {
    const correctedBiz = correctedMonthlyBiz(row);
    const correctedSales = correctedMonthlySales(row);
    const key = meta.monthlyColumns.map((col, index) => {
      if (numericNames.has(col) || index === statusIndex) return "";
      if (index === bizIndex) return correctedBiz;
      if (index === salesIndex) return correctedSales;
      return row[index];
    }).join("|");
    if (!groups.has(key)) {
      const copy = row.slice();
      copy[bizIndex] = correctedBiz;
      copy[salesIndex] = correctedSales;
      copy[statusIndex] = getMonthlyStatus(row);
      groups.set(key, copy);
    } else {
      const merged = groups.get(key);
      for (const col of numericNames) {
        const index = M[col];
        merged[index] = Number(merged[index] || 0) + Number(row[index] || 0);
      }
      if (isNewStatus(getMonthlyStatus(row))) merged[statusIndex] = getMonthlyStatus(row);
    }
  }
  return Array.from(groups.values());
}

function tableRows() {
  const q = $("tableSearch").value.trim().toLowerCase();
  const source = activeTable === "daily" ? filtered : mergedMonthlyRows(filteredMonthly);
  const cols = activeTable === "daily" ? meta.columns : meta.monthlyColumns;
  let rows = q ? source.filter(row => {
    const displayValues = row.map((v, i) => activeTable === "monthly" && cols[i] === "业务类型" ? correctedMonthlyBiz(row) : activeTable === "monthly" && cols[i] === "商务" ? correctedMonthlySales(row) : v);
    return displayValues.some(v => `${v}`.toLowerCase().includes(q)) || (activeTable === "monthly" && getMonthlyStatus(row).toLowerCase().includes(q));
  }) : source.slice();
  rows.sort((a, b) => {
    const av = activeTable === "monthly" && cols[sortState.col] === "商机情况" ? getMonthlyStatus(a) : activeTable === "monthly" && cols[sortState.col] === "业务类型" ? correctedMonthlyBiz(a) : activeTable === "monthly" && cols[sortState.col] === "商务" ? correctedMonthlySales(a) : a[sortState.col];
    const bv = activeTable === "monthly" && cols[sortState.col] === "商机情况" ? getMonthlyStatus(b) : activeTable === "monthly" && cols[sortState.col] === "业务类型" ? correctedMonthlyBiz(b) : activeTable === "monthly" && cols[sortState.col] === "商务" ? correctedMonthlySales(b) : b[sortState.col];
    const n = Number(av) - Number(bv);
    const cmp = Number.isFinite(n) && `${av}` !== "" && `${bv}` !== "" ? n : `${av}`.localeCompare(`${bv}`, "zh-CN");
    return sortState.dir === "asc" ? cmp : -cmp;
  });
  return { rows, cols };
}

function renderTableCell(row, cols, i) {
  const col = cols[i];
  const numNames = new Set(["总消耗", "非赠款消耗", "赠款消耗"]);
  if (activeTable === "monthly" && col === "商机情况") {
    const current = getMonthlyStatus(row);
    const options = opportunityStatusOptions.map(status => `<option value="${escapeHtml(status)}"${status === current ? " selected" : ""}>${escapeHtml(status)}</option>`).join("");
    return `<td><select class="statusSelect" data-status-id="${escapeHtml(monthlyStatusId(row))}">${options}</select></td>`;
  }
  if (activeTable === "monthly" && col === "业务类型") {
    return `<td>${escapeHtml(correctedMonthlyBiz(row))}</td>`;
  }
  if (activeTable === "monthly" && col === "商务") {
    return `<td>${escapeHtml(correctedMonthlySales(row))}</td>`;
  }
  return `<td class="${numNames.has(col) ? "num" : ""}">${numNames.has(col) ? fmtMoney(row[i]) : escapeHtml(row[i])}</td>`;
}

function renderTable() {
  const { rows, cols } = tableRows();
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  currentPage = Math.min(currentPage, totalPages);
  const pageRows = rows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const numNames = new Set(["总消耗", "非赠款消耗", "赠款消耗"]);
  $("dataTable").innerHTML = `<thead><tr>${cols.map((c, i) => `<th data-col="${i}" class="${numNames.has(c) ? "num" : ""}">${escapeHtml(c)}${sortState.col === i ? (sortState.dir === "asc" ? " ↑" : " ↓") : ""}</th>`).join("")}</tr></thead><tbody>${pageRows.map(row => `<tr>${cols.map((_, i) => renderTableCell(row, cols, i)).join("")}</tr>`).join("")}</tbody>`;
  $("tableInfo").textContent = `当前 ${fmtMoney(rows.length)} 行`;
  $("pageInfo").textContent = `${currentPage} / ${totalPages}`;
  $("prevPage").disabled = currentPage <= 1;
  $("nextPage").disabled = currentPage >= totalPages;
  document.querySelectorAll("#dataTable th").forEach(th => th.addEventListener("click", () => {
    const col = Number(th.dataset.col);
    sortState = { col, dir: sortState.col === col && sortState.dir === "asc" ? "desc" : "asc" };
    renderTable();
  }));
  document.querySelectorAll(".statusSelect").forEach(select => select.addEventListener("change", () => {
    pendingStatusOverrides[select.dataset.statusId] = select.value;
    renderOverview();
    renderTargets();
    renderTable();
  }));
}

function saveStatusChanges() {
  if (!Object.keys(pendingStatusOverrides).length) {
    $("saveStatusChanges").textContent = "已保存";
    setTimeout(() => { $("saveStatusChanges").textContent = "保存本次修改"; }, 1000);
    return;
  }
  const overrides = getStatusOverrides();
  setStatusOverrides({ ...overrides, ...pendingStatusOverrides });
  pendingStatusOverrides = {};
  renderOverview();
  renderTargets();
  renderTable();
  $("saveStatusChanges").textContent = "已保存";
  setTimeout(() => { $("saveStatusChanges").textContent = "保存本次修改"; }, 1200);
}

function renderTargets() {
  const month = $("targetMonth").value || meta.dimensions.months[0];
  const targets = getTargets();
  const rows = [];
  const monthRows = visualMonthly.filter(r => r[M.monthKey] === month);
  const keys = new Set(monthRows.map(row => `${row[M["所属团队"]]}|${correctedMonthlySales(row)}`));
  Object.keys(targets).filter(k => k.startsWith(`${month}|`)).forEach(k => keys.add(k.split("|").slice(1).join("|")));
  for (const key of Array.from(keys).sort((a, b) => a.localeCompare(b, "zh-CN"))) {
    const [team, sales] = key.split("|");
    const personRows = monthRows.filter(r => r[M["所属团队"]] === team && correctedMonthlySales(r) === sales);
    const actualSpend = sum(personRows, M["非赠款消耗"]);
    const actualNew = groupedNew(personRows, r => "x").find(x => x.label === "x")?.value || 0;
    const target = targets[`${month}|${team}|${sales}`] || { spend: 0, fresh: 0 };
    rows.push({ team, sales, actualSpend, actualNew, spendTarget: Number(target.spend || 0), newTarget: Number(target.fresh || 0) });
  }
  const labels = rows.map(r => `${r.team}-${r.sales}`);
  chart("targetSpendChart", "bar", labels, [
    { label: "实际消耗", data: rows.map(r => r.actualSpend), backgroundColor: palette.blue },
    { label: "消耗目标", data: rows.map(r => r.spendTarget), backgroundColor: palette.amber }
  ], { indexAxis: "y" });
  chart("targetNewChart", "bar", labels, [
    { label: "实际新开", data: rows.map(r => r.actualNew), backgroundColor: palette.green },
    { label: "新开目标", data: rows.map(r => r.newTarget), backgroundColor: palette.red }
  ], { indexAxis: "y", countAxis: true });
  $("targetTable").innerHTML = `<thead><tr><th>月份</th><th>团队</th><th>商务</th><th class="num">实际消耗</th><th class="num">消耗目标</th><th class="num">消耗达成</th><th class="num">实际新开</th><th class="num">新开目标</th><th class="num">新开达成</th></tr></thead><tbody>${rows.map(r => `<tr><td>${month}</td><td>${escapeHtml(r.team)}</td><td>${escapeHtml(r.sales)}</td><td class="num">${fmtWan(r.actualSpend)}万</td><td class="num">${fmtWan(r.spendTarget)}万</td><td class="num">${fmtPct(r.actualSpend, r.spendTarget)}</td><td class="num">${r.actualNew}</td><td class="num">${r.newTarget}</td><td class="num">${fmtPct(r.actualNew, r.newTarget)}</td></tr>`).join("")}</tbody>`;
}

function setProgress(id, percent) {
  const el = $(id);
  if (el) el.style.width = `${Math.max(0, Math.min(100, percent || 0))}%`;
}

function targetSpendForMonth(month, team, sales = "") {
  const targets = getTargets();
  return Object.entries(targets).reduce((acc, [key, value]) => {
    const [m, t, s] = key.split("|");
    if (m === month && (!team || t === team) && (!sales || s === sales)) return acc + Number(value.spend || 0);
    return acc;
  }, 0);
}

function renderDisplay() {
  if (!$("display")) return;
  const end = $("endDate").value || meta.dateMax;
  const month = end.slice(0, 7);
  const [year, monthNum] = month.split("-").map(Number);
  const monthStart = `${month}-01`;
  const monthEnd = dateStr(new Date(year, monthNum, 0));
  const displayRows = allLocalPushRows.filter(row => row[C.date] >= monthStart && row[C.date] <= end);
  const yesterday = latestDate(displayRows) || end;
  const yesterdayRows = displayRows.filter(row => row[C.date] === yesterday);
  const elapsedDays = Math.max(1, dateObj(end).getDate());
  const targetDays = Number(monthEnd.slice(8, 10));
  const progress = elapsedDays / targetDays * 100;
  const monthName = `M${monthNum}`;
  $("displayMonthTitle").textContent = `${monthName}时间进度`;
  $("displayMonthProgress").textContent = `${pctFmt.format(progress)}%`;
  $("displayMonthProgressText").textContent = `当前 ${elapsedDays} 天｜目标 ${targetDays} 天`;
  $("displayCountdownTitle").textContent = `距离${monthName}结束还有：`;
  setProgress("displayMonthProgressBar", progress);

  const now = new Date();
  const endDate = new Date(`${monthEnd}T23:59:59`);
  const seconds = Math.max(0, Math.floor((endDate - now) / 1000));
  $("displayDays").textContent = String(Math.floor(seconds / 86400)).padStart(2, "0");
  $("displayHours").textContent = String(Math.floor(seconds % 86400 / 3600)).padStart(2, "0");
  $("displayMinutes").textContent = String(Math.floor(seconds % 3600 / 60)).padStart(2, "0");
  $("displaySeconds").textContent = String(seconds % 60).padStart(2, "0");

  const trendRows = allLocalPushRows.filter(row => row[C.date].startsWith(String(year)));
  const trend = group(trendRows, row => row[C.date]);
  chart("bigScreenTrend", "line", trend.map(x => x.label), [{
    label: "本地推日耗",
    data: trend.map(x => x.value),
    borderColor: palette.blue,
    backgroundColor: "rgba(82,119,246,.14)",
    tension: .28
  }]);

  const teams = ["销售一组", "销售二组"];
  for (const [idx, team] of teams.entries()) {
    const actual = sum(displayRows.filter(row => row[C["所属团队"]] === team), C["非赠款消耗"]);
    const target = targetSpendForMonth(month, team);
    const pct = target ? actual / target * 100 : 0;
    const prefix = idx === 0 ? "One" : "Two";
    $(`displayTeam${prefix}Title`).textContent = `${monthName}${team}消耗目标达成`;
    $(`displayTeam${prefix}Pct`).textContent = target ? `${pctFmt.format(pct)}%` : "-";
    $(`displayTeam${prefix}Text`).textContent = `当前 ${fmtWan(actual)}万｜目标 ${fmtWan(target)}万`;
    setProgress(`displayTeam${prefix}Bar`, pct);
  }

  const salesSpend = group(displayRows, correctedDailySales).sort((a, b) => b.value - a.value).slice(0, 10);
  const completionRows = salesSpend.map(item => {
    const rows = displayRows.filter(row => correctedDailySales(row) === item.label);
    const team = rows[0]?.[C["所属团队"]] || "";
    const target = targetSpendForMonth(month, team, item.label);
    return { label: item.label, value: target ? item.value / target * 100 : 0 };
  }).sort((a, b) => b.value - a.value).slice(0, 10);
  chart("bigScreenCompletionRank", "bar", completionRows.map(x => x.label), [{ label: "完成率", data: completionRows.map(x => x.value), backgroundColor: palette.blue }], {
    indexAxis: "y",
    countAxis: true,
    showValueLabels: true,
    valueLabelKind: "percent",
    scales: {
      x: { beginAtZero: true, max: 100, ticks: { callback: v => `${v}%` } },
      y: { beginAtZero: true }
    },
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: ctx => `完成率: ${pctFmt.format(ctx.parsed.x)}%` } }
    }
  });
  chart("bigScreenSpendRank", "bar", salesSpend.map(x => x.label), [{ label: "月消耗", data: salesSpend.map(x => x.value), backgroundColor: palette.blue }], { indexAxis: "y", showValueLabels: true });
  const yesterdayRank = group(yesterdayRows, correctedDailySales).sort((a, b) => b.value - a.value).slice(0, 10);
  chart("bigScreenYesterdayRank", "bar", yesterdayRank.map(x => x.label), [{ label: "昨日消耗", data: yesterdayRank.map(x => x.value), backgroundColor: palette.red }], { indexAxis: "y", showValueLabels: true });
}

function renderAll() {
  renderTime();
  renderOverview();
  renderTable();
  renderTargets();
  renderDisplay();
}

function exportCsv() {
  const { rows, cols } = tableRows();
  const exportRows = activeTable === "monthly"
    ? rows.map(row => row.map((v, i) => cols[i] === "商机情况" ? getMonthlyStatus(row) : cols[i] === "业务类型" ? correctedMonthlyBiz(row) : cols[i] === "商务" ? correctedMonthlySales(row) : v))
    : rows;
  const csv = [cols, ...exportRows].map(row => row.map(v => `"${`${v ?? ""}`.replaceAll('"', '""')}"`).join(",")).join("\n");
  const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${activeTable === "daily" ? "每日明细" : "月度汇总"}-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function init() {
  $("dataRange").textContent = `数据范围：${meta.dateMin} 至 ${meta.dateMax}；首页统计口径：投流类别=本地推，消耗=非赠款消耗；生成时间：${meta.generatedAt}`;
  const years = Array.from(new Set(meta.dimensions.months.map(m => m.slice(0, 4)))).sort();
  optionFill("yearFilter", years);
  optionFill("quarterQuick", meta.dimensions.quarters);
  optionFill("monthQuick", meta.dimensions.months);
  $("yearFilter").value = meta.dateMax.slice(0, 4);
  $("quarterQuick").value = `Q${Math.floor((Number(meta.dateMax.slice(5, 7)) - 1) / 3) + 1}`;
  $("monthQuick").value = meta.dateMax.slice(0, 7);
  $("startDate").value = meta.dateMin;
  $("endDate").value = meta.dateMax;
  optionFill("categoryFilter", meta.dimensions.categories);
  optionFill("bizFilter", meta.dimensions.businessTypes);
  optionFill("teamFilter", meta.dimensions.teams);
  optionFill("salesFilter", meta.dimensions.sales);
  optionFill("projectFilter", meta.dimensions.projects);
  optionFill("targetMonth", meta.dimensions.months);
  optionFill("businessTargetMonth", meta.dimensions.months);
  optionFill("targetTeam", meta.dimensions.teams);
  optionFill("targetSales", meta.dimensions.sales);
  $("periodMode").value = "month";
  document.querySelectorAll(".filters input, .filters select").forEach(el => el.addEventListener("change", syncFilterControls));
  $("periodMode").addEventListener("change", syncFilterControls);
  $("applyFilters").addEventListener("click", applyFilters);
  $("resetFilters").addEventListener("click", () => {
    $("periodMode").value = "month";
    $("yearFilter").value = meta.dateMax.slice(0, 4);
    $("quarterQuick").value = `Q${Math.floor((Number(meta.dateMax.slice(5, 7)) - 1) / 3) + 1}`;
    $("monthQuick").value = meta.dateMax.slice(0, 7);
    ["categoryFilter", "bizFilter", "teamFilter", "salesFilter", "projectFilter"].forEach(id => Array.from($(id).options).forEach(o => o.selected = false));
    syncFilterControls();
    applyFilters();
  });
  document.querySelectorAll(".tab").forEach(btn => btn.addEventListener("click", () => {
    document.querySelectorAll(".tab,.panel").forEach(el => el.classList.remove("active"));
    btn.classList.add("active");
    $(btn.dataset.tab).classList.add("active");
    setTimeout(renderAll, 0);
  }));
  document.querySelectorAll(".subtab").forEach(btn => btn.addEventListener("click", () => {
    document.querySelectorAll(".subtab").forEach(el => el.classList.remove("active"));
    btn.classList.add("active");
    activeTable = btn.dataset.table;
    sortState = { col: 0, dir: "asc" };
    currentPage = 1;
    renderTable();
  }));
  $("tableSearch").addEventListener("input", () => { currentPage = 1; renderTable(); });
  $("prevPage").addEventListener("click", () => { currentPage--; renderTable(); });
  $("nextPage").addEventListener("click", () => { currentPage++; renderTable(); });
  $("saveStatusChanges").addEventListener("click", saveStatusChanges);
  $("exportCsv").addEventListener("click", exportCsv);
  $("targetMonth").addEventListener("change", renderTargets);
  function fillBusinessTargetInputs() {
    const month = $("businessTargetMonth").value;
    const targets = getBusinessTargets();
    $("rechargeBizTarget").value = yuanToWanInput(targets[`${month}|代充值`]);
    $("operateBizTarget").value = yuanToWanInput(targets[`${month}|代运营`]);
  }
  $("businessTargetMonth").addEventListener("change", fillBusinessTargetInputs);
  $("saveBusinessTarget").addEventListener("click", () => {
    const month = $("businessTargetMonth").value;
    const targets = getBusinessTargets();
    targets[`${month}|代充值`] = Number($("rechargeBizTarget").value || 0) * 10000;
    targets[`${month}|代运营`] = Number($("operateBizTarget").value || 0) * 10000;
    setBusinessTargets(targets);
    renderOverview();
    renderTargets();
    renderDisplay();
  });
  function fillTargetInputs() {
    const target = getTargets()[`${$("targetMonth").value}|${$("targetTeam").value}|${$("targetSales").value}`] || {};
    $("spendTarget").value = yuanToWanInput(target.spend);
    $("newTarget").value = target.fresh || "";
  }
  ["targetMonth", "targetTeam", "targetSales"].forEach(id => $(id).addEventListener("change", fillTargetInputs));
  $("saveTarget").addEventListener("click", () => {
    const month = $("targetMonth").value;
    const team = $("targetTeam").value;
    const sales = $("targetSales").value;
    const targets = getTargets();
    targets[`${month}|${team}|${sales}`] = { spend: Number($("spendTarget").value || 0) * 10000, fresh: Number($("newTarget").value || 0) };
    setTargets(targets);
    renderTargets();
    renderOverview();
  });
  syncFilterControls();
  applyFilters();
  fillTargetInputs();
  fillBusinessTargetInputs();
}

init();
