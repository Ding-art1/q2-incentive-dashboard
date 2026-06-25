const payload = window.PERFORMANCE_DATA;
const meta = payload.meta;
const cols = Object.fromEntries(meta.columns.map((name, i) => [name, i]));
const selfCols = Object.fromEntries(meta.selfColumns.map((name, i) => [name, i]));
const moneyFmt = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 });
const wanFmt = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 });
const pctFmt = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 });
const newLabelKey = "performance-dashboard-new-labels-v1";
const newProjectKey = "performance-dashboard-new-projects-v1";
const uploadHistoryKey = "performance-dashboard-upload-history-v1";
const targetKey = "performance-dashboard-targets-v1";
const authKey = "performance-dashboard-auth-v1";
const users = [
  { account: "admin", name: "管理员", password: "admin888", role: "admin", scopeLabel: "全部数据及管理、上传数据权限" },
  { account: "吕帅印", aliases: ["admin"], name: "吕帅印", password: "adminlsy", role: "team", team: "销售一组", scopeLabel: "商务一组" },
  { account: "程鹏", aliases: ["admin"], name: "程鹏", password: "admincp1", role: "team", team: "销售一组", scopeLabel: "商务一组" },
  { account: "黄文强", aliases: ["admin"], name: "黄文强", password: "hwq9", role: "person", person: "黄文强", scopeLabel: "黄文强本人数据" },
  { account: "陈佳", aliases: ["admin"], name: "陈佳", password: "cj8", role: "person", person: "陈佳", scopeLabel: "陈佳本人数据" },
  { account: "樊俊俊", aliases: ["admin"], name: "樊俊俊", password: "fjj9", role: "person", person: "樊俊俊", scopeLabel: "樊俊俊本人数据" },
  { account: "尤欢", aliases: ["admin"], name: "尤欢", password: "yh1", role: "person", person: "尤欢", scopeLabel: "尤欢本人数据" },
  { account: "陈梦燕", aliases: ["admin"], name: "陈梦燕", password: "cmx8", role: "person", person: "陈梦燕", scopeLabel: "陈梦燕本人数据" },
  { account: "胡金正", aliases: ["admin"], name: "胡金正", password: "hjz9", role: "person", person: "胡金正", scopeLabel: "胡金正本人数据" },
  { account: "于泽", aliases: ["admin"], name: "于泽", password: "yz0", role: "person", person: "于泽", scopeLabel: "于泽本人数据" }
];
const palette = { blue: "#2f6bff", green: "#16a34a", amber: "#f59e0b", red: "#ef2d35", violet: "#5b6ee1", grid: "rgba(124,139,164,.2)", tick: "#748098" };
const defaultTargetRows = [
  { month: "2026-06", level: "business", name: "本地推", spend: 46_000_000, fresh: 0 },
  { month: "2026-06", level: "business", name: "代充值", spend: 43_000_000, fresh: 0 },
  { month: "2026-06", level: "business", name: "代运营", spend: 1_800_000, fresh: 0 },
  { month: "2026-06", level: "team", name: "销售一组", biz: "本地推", spend: 20_000_000, fresh: 0 },
  { month: "2026-06", level: "team", name: "销售二组", biz: "本地推", spend: 25_000_000, fresh: 0 }
];
const salesTeams = {
  "吕帅印": "销售一组",
  "程鹏": "销售一组",
  "黄文强": "销售一组",
  "陈佳": "销售一组",
  "樊俊俊": "销售一组",
  "尤欢": "销售二组",
  "陈梦燕": "销售二组",
  "胡金正": "销售二组",
  "于泽": "销售二组"
};
const noTargetSales = new Set(["魏筱宇"]);
let charts = {};
const baseRows = payload.records;
let allRows = baseRows;
let currentUser = null;
let rows = allRows;
let filtered = rows;
let sortState = { col: 0, dir: "asc" };
let page = 1;
let lostRows = [];
let lostElapsedDays = 0;
const pageSize = 50;

function $(id) { return document.getElementById(id); }
function fmtMoney(v) { return moneyFmt.format(v || 0); }
function fmtWan(v) { return wanFmt.format((v || 0) / 10000); }
function fmtPct(a, b) { return b ? `${pctFmt.format(a / b * 100)}%` : "-"; }
function dateObj(s) { return new Date(`${s}T00:00:00`); }
function dateStr(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function normalizeDateValue(value) {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const d = new Date(value.getTime());
    // SheetJS can materialize Excel date-only cells as the previous day at 16:00
    // in some time zones. These source files are daily snapshots, so normalize
    // afternoon timestamp-only dates forward to the intended Excel date.
    if (d.getHours() >= 12 && d.getMinutes() === 0 && d.getSeconds() === 0) d.setDate(d.getDate() + 1);
    return dateStr(d);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const d = new Date(excelEpoch.getTime() + value * 86400000);
    return dateStr(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
  const text = `${value}`.trim();
  if (!text) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(text)) {
    const [y, m, d] = text.split("/");
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const d = new Date(text);
  if (Number.isNaN(d.getTime())) return text.slice(0, 10);
  if (text.includes("T") && d.getHours() >= 12 && d.getMinutes() === 0 && d.getSeconds() === 0) d.setDate(d.getDate() + 1);
  return dateStr(d);
}
function dataDateMin(list = allRows) { return [...new Set(list.map(r => r[cols.date]).filter(Boolean))].sort()[0] || meta.dateMin; }
function dataDateMax(list = allRows) {
  const dates = [...new Set(list.map(r => r[cols.date]).filter(Boolean))].sort();
  return dates[dates.length - 1] || meta.dateMax;
}
function dataMonths(list = allRows) { return [...new Set(list.map(r => r[cols.monthKey]).filter(Boolean))].sort(); }
function sum(list, idx = cols["非赠款消耗"]) { return list.reduce((acc, row) => acc + Number(row[idx] || 0), 0); }
function esc(v) { return `${v ?? ""}`.replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch])); }
function monthOf(date) { return date.slice(0, 7); }
function prevDate(date, days) { const d = dateObj(date); d.setDate(d.getDate() - days); return dateStr(d); }
function group(list, keyFn, idx = cols["非赠款消耗"]) {
  const map = new Map();
  for (const row of list) {
    const key = keyFn(row) || "未填写";
    map.set(key, (map.get(key) || 0) + Number(row[idx] || 0));
  }
  return Array.from(map, ([label, value]) => ({ label, value }));
}
function uniqueCount(list, keyFn) { return new Set(list.map(keyFn).filter(Boolean)).size; }
function grade(spend) { return spend >= 1000000 ? "SS" : spend >= 500000 ? "S" : spend >= 200000 ? "A" : spend >= 60000 ? "B" : "C"; }
function salesTeam(row) { return salesTeams[row[cols["商务"]]] || "未分组"; }
function newLabels() { return JSON.parse(localStorage.getItem(newLabelKey) || "{}"); }
function setNewLabels(v) { localStorage.setItem(newLabelKey, JSON.stringify(v)); }
function newProjects() { return JSON.parse(localStorage.getItem(newProjectKey) || "{}"); }
function setNewProjects(v) { localStorage.setItem(newProjectKey, JSON.stringify(v)); }
function effectiveNewLabel(entry, labels = newLabels()) { return labels[entry.labelKey] || entry.defaultLabel || "存量商机"; }
function labelToBelong(label, fallback = "") {
  if (label === "代充值新渠道" || label === "历史渠道新增主体") return "渠道推荐";
  if (label === "代充值新客户" || label === "代运营新客户") return "直客自拓";
  return fallback;
}
function projectOptions(current = "") {
  const list = [current, "未填写", ...rows.map(r => r[cols["项目"]])].filter(Boolean);
  return [...new Set(list)];
}
function projectDatalistId(key) {
  return `project-options-${`${key}`.replace(/[^\w\u4e00-\u9fa5-]/g, "-")}`;
}
function portRegion(portId) {
  const port = `${portId || ""}`.trim();
  if (["85615476348", "1740032442332232"].includes(port)) return "深圳端口";
  if (["1740118613345288", "1816320944718987", "1818671124422667"].includes(port)) return "海南端口";
  return "";
}
function rowPortRegion(row) {
  return row[cols["端口归属"]] || portRegion(row[cols["端口ID"]]) || "未填写";
}
function uploadHistory() { return JSON.parse(localStorage.getItem(uploadHistoryKey) || "[]"); }
function setUploadHistory(v) { localStorage.setItem(uploadHistoryKey, JSON.stringify(v)); }
function relationLookup() {
  const relationCols = Object.fromEntries(meta.relationColumns.map((name, i) => [name, i]));
  const map = new Map();
  for (const row of payload.relations || []) {
    map.set(`${row[relationCols["商机名称"]]}|${row[relationCols["广告主主体"]]}`, {
      belong: row[relationCols["直客or渠道"]] || "",
      project: row[relationCols["项目"]] || ""
    });
  }
  return map;
}
const relationMap = relationLookup();
const uploadAliases = {
  date: ["date", "日期", "消耗日期", "数据日期", "时间"],
  accountId: ["账户ID", "广告主ID", "账户id", "广告主id", "账号ID", "账号id"],
  accountName: ["账户名称", "广告主名称", "账号名称"],
  subject: ["广告主主体", "主体", "广告主体", "广告主公司名称", "公司名称"],
  opportunity: ["商机名称", "包含商机", "商机", "客户/渠道", "客户名称"],
  sales: ["商务", "商务名称", "负责人"],
  biz: ["合作模式-DOSS", "合作模式", "业务类型", "业务"],
  division: ["事业部"],
  bu: ["BU"],
  portId: ["端口ID", "端口id", "端口账号ID", "端口账号id"],
  portBelong: ["端口归属", "端口", "端口名称"],
  mediaPort: ["媒体端口", "投流类别", "媒体", "平台"],
  industry1: ["一级行业"],
  industry2: ["二级行业"],
  totalSpend: ["总消耗", "总消耗(元)", "总消耗（元）", "消耗"],
  nonGrantSpend: ["非赠款消耗", "非赠款消耗(元)", "非赠款消耗（元）", "现金消耗", "实际消耗", "非赠款"],
  grantSpend: ["赠款消耗", "赠款消耗(元)", "赠款消耗（元）", "赠款"],
  belong: ["归属类别", "直客or渠道", "直签or渠道", "客户归属", "归属"],
  customerType: ["客户类型", "类型", "直签/渠道"],
  project: ["项目", "项目名称"]
};
function normalizeObjectKeys(row) {
  const result = {};
  for (const [key, value] of Object.entries(row || {})) {
    result[`${key}`.trim()] = value;
  }
  return result;
}
function pickField(row, names) {
  for (const name of names) {
    if (row[name] !== undefined && row[name] !== null && `${row[name]}` !== "") return row[name];
  }
  return "";
}
function numericField(row, names) {
  const raw = pickField(row, names);
  if (typeof raw === "number") return raw;
  const text = `${raw || ""}`.replace(/,/g, "").trim();
  const value = Number(text);
  return Number.isFinite(value) ? value : 0;
}
function normalizeMediaPort(value) {
  const text = `${value || ""}`.trim();
  if (!text) return "";
  if (text === "本地推") return "巨量-本地推";
  if (text.toUpperCase() === "AD") return "巨量-AD";
  return text;
}
function canonicalUploadRow(row) {
  const source = normalizeObjectKeys(row);
  const total = numericField(source, uploadAliases.totalSpend);
  const grant = numericField(source, uploadAliases.grantSpend);
  const nonGrantRaw = numericField(source, uploadAliases.nonGrantSpend);
  const nonGrant = nonGrantRaw || Math.max(total - grant, 0);
  const mediaPort = normalizeMediaPort(pickField(source, uploadAliases.mediaPort));
  return {
    "日期": pickField(source, uploadAliases.date),
    "账户ID": pickField(source, uploadAliases.accountId),
    "账户名称": pickField(source, uploadAliases.accountName),
    "广告主主体": pickField(source, uploadAliases.subject),
    "商机名称": pickField(source, uploadAliases.opportunity),
    "商务": pickField(source, uploadAliases.sales),
    "合作模式-DOSS": pickField(source, uploadAliases.biz),
    "事业部": pickField(source, uploadAliases.division),
    "BU": pickField(source, uploadAliases.bu),
    "端口ID": pickField(source, uploadAliases.portId),
    "端口归属": pickField(source, uploadAliases.portBelong),
    "媒体端口": mediaPort,
    "一级行业": pickField(source, uploadAliases.industry1),
    "二级行业": pickField(source, uploadAliases.industry2),
    "总消耗": total || nonGrant + grant,
    "非赠款消耗": nonGrant,
    "赠款消耗": grant,
    "归属类别": pickField(source, uploadAliases.belong),
    "客户类型": pickField(source, uploadAliases.customerType),
    "项目": pickField(source, uploadAliases.project)
  };
}
function uploadedRecordFromObject(row) {
  const canonical = canonicalUploadRow(row);
  const date = normalizeDateValue(canonical["日期"]);
  if (!date) return null;
  const d = dateObj(date);
  const monthKey = date.slice(0, 7);
  const opportunity = canonical["商机名称"] || "";
  const subject = canonical["广告主主体"] || "";
  const relation = relationMap.get(`${opportunity}|${subject}`) || {};
  const labels = newLabels();
  const projects = newProjects();
  const opportunityKey = opportunity;
  const channelSubjectKey = `channelSubject|${opportunity}|${subject}`;
  const savedLabel = labels[channelSubjectKey] || labels[opportunityKey] || "";
  const belong = labelToBelong(savedLabel, canonical["归属类别"] || relation.belong || "");
  const customerType = canonical["客户类型"] || (belong === "渠道推荐" || `${belong}`.includes("渠道") ? "渠道" : "直签");
  const project = projects[channelSubjectKey] || projects[opportunityKey] || canonical["项目"] || relation.project || opportunity || "";
  const derived = {
    date,
    monthKey,
    "日期": date,
    "月份": `M${Number(date.slice(5, 7))}`,
    "季度": `Q${Math.floor(d.getMonth() / 3) + 1}`,
    "归属类别": belong,
    "客户类型": customerType,
    "项目": project,
    "端口归属": canonical["端口归属"] || portRegion(canonical["端口ID"])
  };
  return meta.columns.map(name => {
    const value = derived[name] ?? canonical[name] ?? "";
    return ["总消耗", "非赠款消耗", "赠款消耗"].includes(name) ? Number(value || 0) : value;
  });
}
function uploadedRecords() {
  return uploadHistory().flatMap(item => {
    const columns = item.columns || [];
    return (item.rows || [])
      .map(values => Object.fromEntries(columns.map((col, i) => [col, values[i]])))
      .map(uploadedRecordFromObject)
      .filter(Boolean);
  });
}
function recordKey(row) {
  return [
    row[cols.date],
    row[cols["账户ID"]],
    row[cols["广告主主体"]],
    row[cols["商机名称"]],
    row[cols["商务"]],
    row[cols["媒体端口"]],
    row[cols["非赠款消耗"]],
    row[cols["总消耗"]]
  ].map(v => `${v ?? ""}`).join("|");
}
function rebuildAllRows() {
  const seen = new Set();
  allRows = [];
  for (const row of [...baseRows, ...uploadedRecords()]) {
    const key = recordKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    allRows.push(row);
  }
}
function rowValue(row, columns, name) {
  if (Array.isArray(row)) return row[columns.indexOf(name)] || "";
  return row[name] || "";
}
function isChannelType(type, belong = "") { return type === "渠道" || `${belong}`.includes("渠道"); }
function isDirectType(type, belong = "") { return type === "直签" || `${belong}`.includes("直签"); }
function isChannelRow(row) { return isChannelType(row[cols["客户类型"]], row[cols["归属类别"]]); }
function isDirectRow(row) { return isDirectType(row[cols["客户类型"]], row[cols["归属类别"]]); }
function isLocalPushRow(row) { return row[cols["媒体端口"]] === "巨量-本地推"; }
function localPushRows(list) { return list.filter(isLocalPushRow); }
function isAdmin() { return currentUser?.role === "admin"; }
function authUser(account, password) {
  const name = `${account || ""}`.trim();
  const pass = `${password || ""}`.trim();
  return users.find(user => user.password === pass && (user.account === name || (user.aliases || []).includes(name)));
}
function scopedRowsFor(user) {
  if (!user || user.role === "admin") return allRows;
  if (user.role === "team") return allRows.filter(row => salesTeam(row) === user.team);
  if (user.role === "person") return allRows.filter(row => row[cols["商务"]] === user.person);
  return [];
}
function salesAllowed(sales) {
  if (isAdmin()) return true;
  if (currentUser?.role === "team") return salesTeams[sales] === currentUser.team;
  if (currentUser?.role === "person") return sales === currentUser.person;
  return false;
}
function entryAllowed(entry) { return salesAllowed(entry.sales || ""); }
function uploadedRowAllowed(colMap) { return salesAllowed(colMap["商务"] || ""); }
function savedAuthUser() {
  const saved = JSON.parse(sessionStorage.getItem(authKey) || "null");
  if (!saved) return null;
  return users.find(user => user.account === saved.account && user.password === saved.password) || null;
}
function showLogin() {
  document.body.classList.add("auth-locked");
  document.body.classList.remove("auth-ready");
  $("loginForm").onsubmit = event => {
    event.preventDefault();
    const user = authUser($("loginAccount").value, $("loginPassword").value);
    if (!user) {
      $("loginError").textContent = "账号或密码不正确";
      return;
    }
    sessionStorage.setItem(authKey, JSON.stringify({ account: user.account, password: user.password }));
    location.reload();
  };
}
function applyAuth(user) {
  currentUser = user;
  rebuildAllRows();
  rows = scopedRowsFor(user);
  filtered = rows;
  document.body.classList.remove("auth-locked");
  document.body.classList.remove("admin-user", "team-user", "person-user", "my-dashboard-active");
  document.body.classList.add("auth-ready", isAdmin() ? "admin-user" : "not-admin", `${user.role}-user`);
  $("currentUser").textContent = `${user.name}｜${user.scopeLabel}`;
  $("logoutBtn").onclick = () => {
    sessionStorage.removeItem(authKey);
    location.reload();
  };
}
function targetBusiness(row) {
  if (row.level === "business") return row.name;
  return row.biz || "本地推";
}
function normalizeTargetRow(row) {
  if (!row) return row;
  return row.level === "business" ? { ...row, biz: "" } : { ...row, biz: row.biz || "本地推" };
}
function targetId(row) {
  const normalized = normalizeTargetRow(row);
  return `${normalized.month}|${normalized.level}|${normalized.name}|${normalized.biz || ""}`;
}
function getTargets() {
  const saved = JSON.parse(localStorage.getItem(targetKey) || "{}");
  const normalizeMap = source => Object.fromEntries(Object.values(source).map(row => {
    const normalized = normalizeTargetRow(row);
    return [targetId(normalized), normalized];
  }));
  const defaults = normalizeMap(defaultTargetRows);
  return { ...defaults, ...normalizeMap(saved) };
}
function setTargets(v) { localStorage.setItem(targetKey, JSON.stringify(v)); }
function targetRows(month = "") {
  return Object.values(getTargets()).filter(row => !month || row.month === month);
}
function targetFor(month, level, name, biz = "") {
  const targetBiz = level === "business" ? "" : biz || "本地推";
  return getTargets()[`${month}|${level}|${name}|${targetBiz}`] || { month, level, name, biz: targetBiz, spend: 0, fresh: 0 };
}
function targetVisible(row) {
  if (row.level === "person" && noTargetSales.has(row.name)) return false;
  if (isAdmin()) return true;
  if (currentUser?.role === "team") {
    return (row.level === "team" && row.name === currentUser.team) || (row.level === "person" && salesTeams[row.name] === currentUser.team);
  }
  if (currentUser?.role === "person") return row.level === "person" && row.name === currentUser.person;
  return false;
}

function chart(id, type, labels, datasets, options = {}) {
  if (!$(id)) return;
  if (charts[id]) charts[id].destroy();
  const horizontal = options.indexAxis === "y";
  const countAxis = options.countAxis;
  charts[id] = new Chart($(id), {
    type,
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: datasets.length > 1 },
        tooltip: { callbacks: { label(ctx) {
          const value = type === "doughnut" ? ctx.parsed : horizontal ? ctx.parsed.x : (ctx.parsed.y ?? ctx.parsed.x);
          if (type === "doughnut") {
            const total = ctx.dataset.data.reduce((a, b) => a + Number(b || 0), 0);
            return `${fmtWan(value)}w｜占比 ${pctFmt.format(total ? value / total * 100 : 0)}%`;
          }
          return countAxis ? fmtMoney(value) : `${fmtWan(value)}w`;
        } } }
      },
      scales: type === "doughnut" ? {} : horizontal ? {
        x: { beginAtZero: true, grid: { color: palette.grid }, ticks: { color: palette.tick, callback: v => countAxis ? fmtMoney(v) : `${fmtWan(v)}w` } },
        y: { grid: { color: palette.grid }, ticks: { color: palette.tick, autoSkip: false } }
      } : {
        y: { beginAtZero: true, grid: { color: palette.grid }, ticks: { color: palette.tick, callback: v => countAxis ? fmtMoney(v) : `${fmtWan(v)}w` } },
        x: { grid: { color: palette.grid }, ticks: { color: palette.tick, maxRotation: 35 } }
      },
      ...options
    }
  });
}

function metric(title, value, sub = "", cls = "") {
  return `<article class="metric ${cls}"><strong>${esc(value)}</strong><span>${esc(title)}</span>${sub ? `<em>${esc(sub)}</em>` : ""}</article>`;
}
function bizRows(list, name) {
  if (name === "本地推") return localPushRows(list);
  return localPushRows(list).filter(r => r[cols["合作模式-DOSS"]] === name);
}
function periodMonths(list) {
  return [...new Set(list.map(r => r[cols.monthKey]).filter(Boolean))];
}
function targetForPeriod(name, list) {
  return periodMonths(list).reduce((acc, month) => acc + (targetFor(month, "business", name).spend || 0), 0);
}
function scopedDashboardTargetForPeriod(name, list) {
  if (!document.body.classList.contains("my-dashboard-active")) return targetForPeriod(name, list);
  const months = periodMonths(list);
  if (currentUser?.role === "person") {
    return months.reduce((acc, month) => acc + (targetFor(month, "person", currentUser.person, name).spend || 0), 0);
  }
  if (currentUser?.role === "team") {
    return months.reduce((acc, month) => acc + (targetFor(month, "team", currentUser.team, name).spend || 0), 0);
  }
  return targetForPeriod(name, list);
}
function startOfWeek(date) {
  const d = dateObj(date);
  const day = d.getDay() || 7;
  d.setDate(d.getDate() - day + 1);
  return dateStr(d);
}
function weekSeries(list, startDate) {
  const start = dateObj(startDate);
  const map = new Map();
  for (const row of list) {
    const idx = Math.floor((dateObj(row[cols.date]) - start) / 86400000 / 7) + 1;
    const label = `week${Math.max(1, idx)}`;
    map.set(label, (map.get(label) || 0) + Number(row[cols["非赠款消耗"]] || 0));
  }
  return [...map.entries()].sort((a, b) => Number(a[0].replace("week", "")) - Number(b[0].replace("week", ""))).map(([label, value]) => ({ label, value }));
}
function renderRankList(id, items, limit = 15) {
  const target = $(id);
  if (!target) return;
  const data = items.sort((a, b) => b.value - a.value).slice(0, limit);
  const max = Math.max(...data.map(x => x.value), 1);
  target.innerHTML = data.map(x => `<div class="rankRow"><span>${esc(x.label)}</span><div class="bar"><span style="width:${Math.max(2, x.value / max * 100)}%"></span></div><strong>${fmtWan(x.value)}w</strong></div>`).join("") || `<div class="empty">暂无数据</div>`;
}

function applyFilters() {
  const s = $("startDate").value || dataDateMin(rows);
  const e = $("endDate").value || dataDateMax(rows);
  const biz = $("bizFilter").value;
  const type = $("typeFilter").value;
  filtered = rows.filter(row => row[cols.date] >= s && row[cols.date] <= e && (!biz || row[cols["合作模式-DOSS"]] === biz) && (!type || row[cols["客户类型"]] === type));
  page = 1;
  renderAll();
}
function filteredFor(list) {
  const s = $("startDate").value || dataDateMin(list);
  const e = $("endDate").value || dataDateMax(list);
  const biz = $("bizFilter").value;
  const type = $("typeFilter").value;
  return list.filter(row => row[cols.date] >= s && row[cols.date] <= e && (!biz || row[cols["合作模式-DOSS"]] === biz) && (!type || row[cols["客户类型"]] === type));
}
function dashboardSourceRows() {
  return document.body.classList.contains("my-dashboard-active") ? rows : allRows;
}

function renderTime() {
  const end = $("endDate").value || dataDateMax(rows);
  const d = dateObj(end);
  const year = d.getFullYear();
  const month = d.getMonth();
  const elapsed = d.getDate();
  const monthDays = new Date(year, month + 1, 0).getDate();
  const qStartMonth = Math.floor(month / 3) * 3;
  const qStart = new Date(year, qStartMonth, 1);
  const qEnd = new Date(year, qStartMonth + 3, 0);
  const qElapsed = Math.floor((d - qStart) / 86400000) + 1;
  const qDays = Math.floor((qEnd - qStart) / 86400000) + 1;
  $("monthProgress").textContent = `${pctFmt.format(elapsed / monthDays * 100)}%`;
  $("quarterProgress").textContent = `${pctFmt.format(qElapsed / qDays * 100)}%`;
  $("monthCountdown").textContent = `${Math.max(0, monthDays - elapsed)}天`;
  $("quarterCountdown").textContent = `${Math.max(0, qDays - qElapsed)}天`;
}

function setPublicBar(id, value) {
  const node = $(id);
  if (!node) return;
  node.style.width = `${Math.max(0, Math.min(100, value || 0))}%`;
}

function renderPublicity() {
  if (!$("publicMonthPct")) return;
  const end = $("endDate").value || dataDateMax(allRows);
  const d = dateObj(end);
  const year = d.getFullYear();
  const month = monthOf(end);
  const monthNum = Number(month.slice(5));
  const elapsed = d.getDate();
  const monthDays = new Date(year, d.getMonth() + 1, 0).getDate();
  const monthPct = elapsed / monthDays * 100;
  $("publicMonthTitle").textContent = `M${monthNum}时间进度`;
  $("publicMonthPct").textContent = `${pctFmt.format(monthPct)}%`;
  $("publicElapsedDays").textContent = `当前${elapsed}天`;
  $("publicMonthDays").textContent = `目标${monthDays}天`;
  $("publicCountdownTitle").textContent = `距离M${monthNum}结束还有：`;
  $("publicCountdownDays").textContent = `${Math.max(0, monthDays - elapsed)}`;
  setPublicBar("publicMonthBar", monthPct);

  const publicRows = allRows.filter(r => r[cols.date] <= end);
  const localRows = localPushRows(publicRows);
  const yearRows = localRows.filter(r => r[cols.date] >= `${year}-01-01` && r[cols.date] <= end);
  const yearDates = [...new Set(yearRows.map(r => r[cols.date]))].sort();
  const dailyMap = new Map(group(yearRows, r => r[cols.date]).map(x => [x.label, x.value]));
  chart("publicYearTrend", "line", yearDates, [
    { label: "本地推日耗", data: yearDates.map(date => dailyMap.get(date) || 0), borderColor: palette.blue, backgroundColor: "rgba(47,107,255,.12)", tension: .25 }
  ], { plugins: { legend: { display: false } } });

  const monthRows = localRows.filter(r => r[cols.monthKey] === month && r[cols.date] <= end);
  const teamSummary = (team, prefix, barId) => {
    const actual = sum(monthRows.filter(r => salesTeam(r) === team));
    const target = targetFor(month, "team", team, "本地推").spend || 0;
    const pct = target ? actual / target * 100 : 0;
    $(`${prefix}Title`).textContent = `M${monthNum}${team.replace("销售", "销售")}消耗目标达成`;
    $(`${prefix}Pct`).textContent = `${pctFmt.format(pct)}%`;
    $(`${prefix}Actual`).textContent = `当前${fmtWan(actual)}w`;
    $(`${prefix}Target`).textContent = `目标${fmtWan(target)}w`;
    setPublicBar(barId, pct);
  };
  teamSummary("销售一组", "publicTeamOne", "publicTeamOneBar");
  teamSummary("销售二组", "publicTeamTwo", "publicTeamTwoBar");

  const salesNames = [...new Set(monthRows.map(r => r[cols["商务"]]).filter(Boolean))];
  const completion = salesNames.map(name => {
    const actual = sum(monthRows.filter(r => r[cols["商务"]] === name));
    const target = targetFor(month, "person", name, "本地推").spend || 0;
    return { name, actual, target, pct: target ? actual / target * 100 : 0 };
  }).sort((a, b) => b.pct - a.pct).slice(0, 10);
  $("publicCompletionTitle").textContent = `M${monthNum}消耗完成率排行`;
  chart("publicCompletionChart", "bar", completion.map(x => x.name), [
    { label: "完成率", data: completion.map(x => x.pct), backgroundColor: palette.blue }
  ], {
    indexAxis: "y",
    scales: {
      x: { beginAtZero: true, grid: { color: palette.grid }, ticks: { color: palette.tick, callback: v => `${v}%` } },
      y: { grid: { color: palette.grid }, ticks: { color: palette.tick, autoSkip: false } }
    },
    plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `完成率：${pctFmt.format(ctx.parsed.x)}%` } } }
  });

  const monthRank = group(monthRows, r => r[cols["商务"]]).sort((a, b) => b.value - a.value).slice(0, 10);
  $("publicMonthRankTitle").textContent = `M${monthNum}消耗排行`;
  chart("publicMonthRankChart", "bar", monthRank.map(x => x.label), [
    { label: "M月消耗", data: monthRank.map(x => x.value), backgroundColor: palette.blue }
  ], { indexAxis: "y", plugins: { legend: { display: false } } });

  const y = prevDate(end, 1);
  const yRows = localRows.filter(r => r[cols.date] === y);
  const yRank = group(yRows, r => r[cols["商务"]]).sort((a, b) => b.value - a.value).slice(0, 10);
  chart("publicYesterdayRankChart", "bar", yRank.map(x => x.label), [
    { label: "昨日消耗", data: yRank.map(x => x.value), backgroundColor: palette.red }
  ], { indexAxis: "y", plugins: { legend: { display: false } } });
}

function renderDashboard() {
  renderTime();
  const sourceRows = dashboardSourceRows();
  const dashboardFiltered = filteredFor(sourceRows);
  const end = $("endDate").value || dataDateMax(sourceRows);
  const start = $("startDate").value || dataDateMin(sourceRows);
  const y = prevDate(end, 1);
  const prev = prevDate(y, 1);
  const yRows = sourceRows.filter(r => r[cols.date] === y && dashboardFiltered.includes(r));
  const prevRows = sourceRows.filter(r => r[cols.date] === prev && dashboardFiltered.includes(r));
  const local = bizRows(dashboardFiltered, "本地推");
  const recharge = bizRows(dashboardFiltered, "代充值");
  const operate = bizRows(dashboardFiltered, "代运营");
  const bizMetric = (name, list, cls) => {
    const actual = sum(list);
    const target = scopedDashboardTargetForPeriod(name, dashboardFiltered);
    return metric(`${name}实绩`, `${fmtWan(actual)}w`, `目标 ${fmtWan(target)}w｜达成 ${fmtPct(actual, target)}`, cls);
  };
  $("dashboardMetrics").innerHTML = [
    bizMetric("本地推", local, "biz-local"),
    bizMetric("代充值", recharge, "biz-recharge"),
    bizMetric("代运营", operate, "biz-operate"),
  ].join("");

  renderDailyMetrics(y, prev, sourceRows, dashboardFiltered);
  const dates = [...new Set(dashboardFiltered.map(r => r[cols.date]))].sort();
  const dailyFor = list => {
    const map = new Map(group(list, r => r[cols.date]).map(x => [x.label, x.value]));
    return dates.map(date => map.get(date) || 0);
  };
  chart("dailyTrend", "line", dates, [
    { label: "本地推", data: dailyFor(local), borderColor: palette.blue, backgroundColor: "rgba(82,119,246,.12)", tension: .25 },
    { label: "代充值", data: dailyFor(recharge), borderColor: palette.green, backgroundColor: "rgba(27,191,138,.12)", tension: .25 },
    { label: "代运营", data: dailyFor(operate), borderColor: palette.amber, backgroundColor: "rgba(243,154,34,.12)", tension: .25 },
  ]);
  const yLocalRows = localPushRows(yRows);
  renderRankList("yDirectRank", group(yLocalRows.filter(isDirectRow), r => r[cols["项目"]] || r[cols["商机名称"]]), 15);
  renderRankList("yChannelRank", group(yLocalRows.filter(isChannelRow), r => r[cols["项目"]] || r[cols["商机名称"]]), 15);

  renderWeeklyDashboard(start, end, dashboardFiltered);
  renderOperateDashboard(y, dates, operate, sourceRows, dashboardFiltered);
  renderRechargeDashboard(y, start, end, dates, sourceRows, dashboardFiltered);

  const localFiltered = localPushRows(dashboardFiltered);
  const port = group(localFiltered, rowPortRegion);
  const portOrder = ["海南端口", "深圳端口"].filter(label => port.some(x => x.label === label));
  const topPorts = [...portOrder, ...port.filter(x => !portOrder.includes(x.label)).sort((a, b) => b.value - a.value).map(x => x.label)];
  chart("portDailyChart", "line", dates, topPorts.map((label, i) => {
    const list = localFiltered.filter(r => rowPortRegion(r) === label);
    return { label, data: dailyFor(list), borderColor: [palette.blue, palette.green][i], backgroundColor: "rgba(82,119,246,.12)", tension: .25 };
  }));
  const portShare = topPorts.map(label => port.find(x => x.label === label)).filter(Boolean);
  chart("portShareChart", "doughnut", portShare.map(x => x.label), [{ data: portShare.map(x => x.value), backgroundColor: portShare.map((_, i) => [palette.blue, palette.green, palette.amber, palette.violet, palette.red][i % 5]) }]);
}

function renderTargetCharts(bizId = "targetBusinessChart", teamId = "targetTeamChart", personId = "targetPersonChart", sourceRows = rows, scopedTargets = true) {
  const month = monthOf($("endDate").value || dataDateMax(rows));
  const draw = (id, level, limit = 12) => {
    if (!$(id)) return;
    const data = targetProgressRows(month, level, sourceRows, scopedTargets).slice(0, limit);
    chart(id, "bar", data.map(targetChartLabel), [
      { label: "消耗完成率", data: data.map(x => x.spendPct), backgroundColor: palette.blue },
      { label: "新开完成率", data: data.map(x => x.newPct), backgroundColor: palette.green }
    ], {
      indexAxis: "y",
      countAxis: true,
      scales: {
        x: { beginAtZero: true, ticks: { callback: v => `${v}%` } },
        y: { ticks: { autoSkip: false } }
      },
      plugins: {
        tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${pctFmt.format(ctx.parsed.x)}%` } }
      }
    });
  };
  draw(bizId, "business", 8);
  draw(teamId, "team", 8);
  draw(personId, "person", 15);
}

function renderDailyMetrics(y, prev, sourceRows = rows, sourceFiltered = filtered) {
  const yRows = sourceRows.filter(r => r[cols.date] === y && sourceFiltered.includes(r));
  const prevRows = sourceRows.filter(r => r[cols.date] === prev && sourceFiltered.includes(r));
  const localY = sum(bizRows(yRows, "本地推"));
  const rechargeY = sum(bizRows(yRows, "代充值"));
  const operateY = sum(bizRows(yRows, "代运营"));
  $("dailyMetrics").innerHTML = [
    metric("昨日本地推消耗", `${fmtWan(localY)}w`, `较前日 ${fmtWan(localY - sum(bizRows(prevRows, "本地推")))}w`, "biz-local"),
    metric("昨日代充值消耗", `${fmtWan(rechargeY)}w`, `较前日 ${fmtWan(rechargeY - sum(bizRows(prevRows, "代充值")))}w`, "biz-recharge"),
    metric("昨日代运营消耗", `${fmtWan(operateY)}w`, `较前日 ${fmtWan(operateY - sum(bizRows(prevRows, "代运营")))}w`, "biz-operate"),
    metric("当前平均日耗", `${fmtWan(avgDaily(localPushRows(sourceFiltered)))}w`, "", "biz-new"),
  ].join("");
}
function renderWeeklyDashboard(start, end, sourceFiltered = filtered) {
  const weekStart = startOfWeek(end);
  const currentStart = weekStart > start ? weekStart : start;
  const weekRows = sourceFiltered.filter(r => r[cols.date] >= currentStart && r[cols.date] <= end);
  $("weeklyMetrics").innerHTML = [
    metric("本周本地推消耗", `${fmtWan(sum(bizRows(weekRows, "本地推")))}w`, `${currentStart} 至 ${end}`, "biz-local"),
    metric("本周代充值消耗", `${fmtWan(sum(bizRows(weekRows, "代充值")))}w`, `${currentStart} 至 ${end}`, "biz-recharge"),
    metric("本周代运营消耗", `${fmtWan(sum(bizRows(weekRows, "代运营")))}w`, `${currentStart} 至 ${end}`, "biz-operate"),
  ].join("");
  const weekChart = (id, name, color) => {
    const data = weekSeries(bizRows(sourceFiltered, name), start);
    chart(id, "bar", data.map(x => x.label), [{ label: name, data: data.map(x => x.value), backgroundColor: color }]);
  };
  weekChart("localWeekChart", "本地推", palette.blue);
  weekChart("rechargeWeekChart", "代充值", palette.green);
  weekChart("operateWeekChart", "代运营", palette.amber);
}
function renderOperateDashboard(y, dates, operateRows, sourceRows = rows, sourceFiltered = filtered) {
  const yOperate = sourceRows.filter(r => r[cols.date] === y && sourceFiltered.includes(r) && r[cols["合作模式-DOSS"]] === "代运营");
  $("operateMetrics").innerHTML = [
    metric("代运营昨日消耗", `${fmtWan(sum(yOperate))}w`, y, "biz-operate"),
  ].join("");
  const topProjects = group(operateRows, r => r[cols["项目"]] || r[cols["商机名称"]]).sort((a, b) => b.value - a.value).slice(0, 8).map(x => x.label);
  Object.keys(charts).filter(id => id.startsWith("operateProjectDailyChart-")).forEach(id => {
    charts[id].destroy();
    delete charts[id];
  });
  $("operateProjectDailyGrid").innerHTML = topProjects.map((project, i) => `
    <section class="miniChart">
      <h5>${esc(project)}</h5>
      <canvas id="operateProjectDailyChart-${i}"></canvas>
    </section>
  `).join("") || `<div class="empty">暂无代运营项目数据</div>`;
  topProjects.forEach((project, i) => {
    const list = operateRows.filter(r => (r[cols["项目"]] || r[cols["商机名称"]]) === project);
    const map = new Map(group(list, r => r[cols.date]).map(x => [x.label, x.value]));
    const colors = [palette.amber, palette.blue, palette.green, palette.violet, palette.red];
    chart(`operateProjectDailyChart-${i}`, "line", dates, [
      { label: project, data: dates.map(date => map.get(date) || 0), borderColor: colors[i % colors.length], backgroundColor: "rgba(243,154,34,.1)", tension: .25 }
    ], { plugins: { legend: { display: false } } });
  });
}
function renderRechargeDashboard(y, start, end, dates, sourceRows = rows, sourceFiltered = filtered) {
  const yRows = sourceRows.filter(r => r[cols.date] === y && sourceFiltered.includes(r));
  const weekStart = startOfWeek(end);
  const currentStart = weekStart > start ? weekStart : start;
  const weekRows = sourceFiltered.filter(r => r[cols.date] >= currentStart && r[cols.date] <= end);
  const teamNames = ["销售一组", "销售二组"];
  const teamMetric = (team, name, list, cls) => metric(`${team}${name}`, `${fmtWan(sum(list.filter(r => salesTeam(r) === team)))}w`, y, cls);
  $("rechargeMetrics").innerHTML = [
    teamMetric("销售一组", "昨日本地推消耗", bizRows(yRows, "本地推"), "biz-local"),
    teamMetric("销售二组", "昨日本地推消耗", bizRows(yRows, "本地推"), "biz-local"),
    teamMetric("销售一组", "昨日代充值消耗", bizRows(yRows, "代充值"), "biz-recharge"),
    teamMetric("销售二组", "昨日代充值消耗", bizRows(yRows, "代充值"), "biz-recharge"),
  ].join("");
  const teamDailyDatasets = teamNames.map((team, i) => {
    const list = bizRows(sourceFiltered, "代充值").filter(r => salesTeam(r) === team);
    const map = new Map(group(list, r => r[cols.date]).map(x => [x.label, x.value]));
    return { label: team, data: dates.map(date => map.get(date) || 0), borderColor: [palette.blue, palette.green][i], backgroundColor: "rgba(82,119,246,.12)", tension: .25 };
  });
  chart("rechargeTeamDailyChart", "line", dates, teamDailyDatasets);
  chart("rechargeTeamWeekChart", "bar", teamNames, [{ label: "本周代充值消耗", data: teamNames.map(team => sum(bizRows(weekRows, "代充值").filter(r => salesTeam(r) === team))), backgroundColor: [palette.blue, palette.green] }]);
  renderTargetCharts("dashboardBusinessTargetChart", "dashboardTeamTargetChart", "dashboardPersonTargetChart", sourceRows, document.body.classList.contains("my-dashboard-active"));
}
function avgDaily(list) {
  const days = group(list, r => r[cols.date]).filter(x => x.value > 0).length || 1;
  return sum(list) / days;
}

function actualRowsForTarget(month, level, name, sourceRows = rows, biz = "") {
  const base = sourceRows.filter(r => r[cols.monthKey] === month && r[cols.date] <= ($("endDate").value || dataDateMax(sourceRows)));
  const business = level === "business" ? name : biz || "本地推";
  const businessRows = bizRows(base, business);
  if (level === "business") return businessRows;
  if (level === "team") return businessRows.filter(r => salesTeam(r) === name);
  if (level === "person") return businessRows.filter(r => r[cols["商务"]] === name);
  return [];
}

function actualNewForTarget(month, level, name, sourceRows = rows, scopedUploads = true, biz = "") {
  const labels = newLabels();
  const counted = new Set();
  const business = level === "business" ? name : biz || "本地推";
  for (const entry of baseNewEntriesForMonth(month, $("endDate").value || dataDateMax(sourceRows), sourceRows)) {
    const label = effectiveNewLabel(entry, labels);
    if (!entry.opportunity || !isFreshCustomerLabel(label) || counted.has(entry.opportunity)) continue;
    const businessMatch = business === "本地推" ? entry.port === "巨量-本地推" : freshLabelMatchesBusiness(label, business);
    if (!businessMatch) continue;
    const match = level === "business"
      ? (name === "本地推" ? entry.port === "巨量-本地推" : freshLabelMatchesBusiness(label, name))
      : level === "team"
        ? salesTeams[entry.sales] === name
        : level === "person"
          ? entry.sales === name
          : false;
    if (match) counted.add(entry.opportunity);
  }
  for (const item of uploadHistory()) {
    for (const row of item.rows || []) {
      const colMap = Object.fromEntries((item.columns || []).map((col, i) => [col, row[i]]));
      if (scopedUploads && !uploadedRowAllowed(colMap)) continue;
      const opportunity = colMap["商机名称"];
      const label = labels[opportunity];
      if (!opportunity || !isFreshCustomerLabel(label) || counted.has(opportunity)) continue;
      const rawDate = colMap["日期"];
      const rowMonth = rawDate instanceof Date ? dateStr(rawDate).slice(0, 7) : `${rawDate || ""}`.slice(0, 7);
      if (rowMonth && rowMonth !== month) continue;
      const biz = colMap["合作模式-DOSS"] || "";
      const port = colMap["媒体端口"] || "";
      const sales = colMap["商务"] || "";
      const businessMatch = business === "本地推" ? port === "巨量-本地推" : freshLabelMatchesBusiness(label, business);
      if (!businessMatch) continue;
      const match = level === "business"
        ? (name === "本地推" ? port === "巨量-本地推" : freshLabelMatchesBusiness(label, name))
        : level === "team"
          ? salesTeams[sales] === name
          : level === "person"
            ? sales === name
            : false;
      if (match) counted.add(opportunity);
    }
  }
  return counted.size;
}

function isFreshCustomerLabel(label) {
  return label === "代充值新客户" || label === "代运营新客户";
}
function freshLabelMatchesBusiness(label, name) {
  return (label === "代充值新客户" && name === "代充值") || (label === "代运营新客户" && name === "代运营");
}
function freshCustomerCounts(month) {
  const labels = newLabels();
  const counted = new Set();
  const result = { recharge: 0, operate: 0, total: 0 };
  for (const entry of baseNewEntriesForMonth(month, $("endDate").value || dataDateMax(rows))) {
    const label = effectiveNewLabel(entry, labels);
    if (!entry.opportunity || !isFreshCustomerLabel(label) || counted.has(entry.opportunity)) continue;
    counted.add(entry.opportunity);
    if (label === "代充值新客户") result.recharge += 1;
    if (label === "代运营新客户") result.operate += 1;
  }
  for (const item of uploadHistory()) {
    for (const row of item.rows || []) {
      const colMap = Object.fromEntries((item.columns || []).map((col, i) => [col, row[i]]));
      if (!uploadedRowAllowed(colMap)) continue;
      const opportunity = colMap["商机名称"];
      const label = labels[opportunity];
      if (!opportunity || !isFreshCustomerLabel(label) || counted.has(opportunity)) continue;
      const rawDate = colMap["日期"];
      const rowMonth = rawDate instanceof Date ? dateStr(rawDate).slice(0, 7) : `${rawDate || ""}`.slice(0, 7);
      if (rowMonth && rowMonth !== month) continue;
      counted.add(opportunity);
      if (label === "代充值新客户") result.recharge += 1;
      if (label === "代运营新客户") result.operate += 1;
    }
  }
  result.total = result.recharge + result.operate;
  return result;
}

function targetProgressRows(month, level, sourceRows = rows, scopedTargets = true) {
  return targetRows(month)
    .filter(row => row.level === level && (!scopedTargets || targetVisible(row)))
    .map(row => {
      const biz = targetBusiness(row);
      const actualSpend = sum(actualRowsForTarget(row.month, row.level, row.name, sourceRows, biz));
      const actualNew = actualNewForTarget(row.month, row.level, row.name, sourceRows, scopedTargets, biz);
      return { ...row, actualSpend, actualNew, spendPct: row.spend ? actualSpend / row.spend * 100 : 0, newPct: row.fresh ? actualNew / row.fresh * 100 : 0 };
    })
    .sort((a, b) => b.spendPct - a.spendPct);
}
function targetChartLabel(row) {
  return row.level === "business" ? row.name : `${row.name}-${targetBusiness(row)}`;
}

function renderReports() {
  const end = $("endDate").value || dataDateMax(rows);
  const y = end;
  $("dailyTitle").textContent = `${y} 数据通报`;
  $("dailySubtitle").textContent = `所有消耗口径为本地推非赠款，目标进度按当月累计计算`;
  const yRows = localPushRows(rows.filter(r => r[cols.date] === y));
  const m = monthOf(y);
  const mRows = localPushRows(rows.filter(r => r[cols.monthKey] === m && r[cols.date] <= y));
  $("dailyHeroTotal").textContent = `${fmtWan(sum(yRows))}w`;
  renderDailyBusinessCards(yRows, mRows, m, y);
  renderDailyNewItems(m, y);
  renderDailyTeams(yRows, mRows, m, y);
  renderDailyRanks(yRows);
  renderDailyVolatility(y);
}

function progressGap(actual, target, date) {
  const complete = target ? actual / target * 100 : 0;
  const time = monthProgressFor(date);
  return { complete, time, gap: complete - time };
}
function dailyProgressCard({ title, value, target, actual, tone, date }) {
  const stat = progressGap(actual, target, date);
  const gapText = stat.gap >= 0 ? `领先时间 ${pctFmt.format(stat.gap)}pct` : `落后时间 ${pctFmt.format(Math.abs(stat.gap))}pct`;
  return `<article class="dailyBizCard ${tone}">
    <span>${esc(title)}</span>
    <strong>${fmtWan(value)}w</strong>
    <div class="dailyMeta"><b>月累 ${fmtWan(actual)}w</b><em>目标 ${fmtWan(target)}w</em></div>
    <div class="dailyDuoBar">
      <p><span>完成</span><i><b style="width:${Math.min(100, Math.max(0, stat.complete))}%"></b></i><strong>${pctFmt.format(stat.complete)}%</strong></p>
      <p><span>时间</span><i><b style="width:${Math.min(100, Math.max(0, stat.time))}%"></b></i><strong>${pctFmt.format(stat.time)}%</strong></p>
    </div>
    <em class="${stat.gap >= 0 ? "good" : "bad"}">${gapText}</em>
  </article>`;
}
function renderDailyBusinessCards(yRows, mRows, month, date) {
  const configs = [
    { name: "本地推", tone: "local" },
    { name: "代充值", tone: "recharge" },
    { name: "代运营", tone: "operate" }
  ];
  $("dailyBizCards").innerHTML = configs.map(item => {
    const dayList = bizRows(yRows, item.name);
    const monthList = bizRows(mRows, item.name);
    const target = targetFor(month, "business", item.name).spend;
    return dailyProgressCard({ title: `昨日${item.name}消耗`, value: sum(dayList), actual: sum(monthList), target, tone: item.tone, date });
  }).join("");
}
function entryFirstDate(entry, sourceRows = rows) {
  const list = sourceRows.filter(r => {
    if (`${entry.key || ""}`.startsWith("channelSubject|")) {
      return r[cols["商机名称"]] === entry.opportunity && r[cols["广告主主体"]] === entry.subject;
    }
    return r[cols["商机名称"]] === entry.opportunity;
  }).map(r => r[cols.date]).filter(Boolean).sort();
  return list[0] || "";
}
function renderDailyNewItems(month, date) {
  const labels = newLabels();
  const projects = newProjects();
  const items = baseNewEntriesForMonth(month, date)
    .map(normalizeNewEntry)
    .filter(entry => entryFirstDate(entry) === date)
    .map(entry => ({ ...entry, label: effectiveNewLabel(entry, labels), projectName: projects[entry.labelKey] || entry.project || "未填写" }));
  const direct = items.filter(x => x.label === "代充值新客户" || x.label === "代运营新客户" || (x.customerType === "直签" && x.label !== "存量商机"));
  const channel = items.filter(x => x.label === "代充值新渠道" || x.label === "历史渠道新增主体" || x.kind.includes("渠道"));
  $("dailyNewDirect").innerHTML = dailyNewList(direct, "直签");
  $("dailyNewChannel").innerHTML = dailyNewList(channel, "渠道");
}
function dailyNewList(list, fallbackType) {
  if (!list.length) return `<p class="empty small">昨日暂无新增${fallbackType}</p>`;
  return `<div class="dailyNewList">${list.slice(0, 8).map(x => `<p><b>${esc(x.projectName || x.opportunity)}</b><span>${esc(x.label || x.kind)}</span><em>${esc(x.sales || "-")}</em></p>`).join("")}</div>`;
}
function targetProgressForScope(month, level, name, sourceRows, date) {
  const targets = targetRows(month).filter(row => row.level === level && row.name === name);
  const target = targets.reduce((acc, row) => acc + Number(row.spend || 0), 0);
  const actual = targets.reduce((acc, row) => acc + sum(actualRowsForTarget(row.month, row.level, row.name, sourceRows, targetBusiness(row))), 0);
  const fallbackActual = level === "team"
    ? sum(sourceRows.filter(r => salesTeam(r) === name))
    : sum(sourceRows.filter(r => r[cols["商务"]] === name));
  return progressGap(targets.length ? actual : fallbackActual, target, date);
}
function renderDailyTeams(yRows, mRows, month, date) {
  const teams = ["销售一组", "销售二组"];
  $("dailyTeamCards").innerHTML = teams.map((team, i) => {
    const day = sum(yRows.filter(r => salesTeam(r) === team));
    const targetRowsForTeam = targetRows(month).filter(row => row.level === "team" && row.name === team);
    const target = targetRowsForTeam.reduce((acc, row) => acc + Number(row.spend || 0), 0);
    const actual = targetRowsForTeam.length
      ? targetRowsForTeam.reduce((acc, row) => acc + sum(actualRowsForTarget(row.month, row.level, row.name, rows, targetBusiness(row))), 0)
      : sum(mRows.filter(r => salesTeam(r) === team));
    return dailyProgressCard({ title: `${team}昨日消耗`, value: day, actual, target, tone: i ? "recharge" : "local", date });
  }).join("");
  const sales = [...new Set(mRows.map(r => r[cols["商务"]]).filter(Boolean))]
    .filter(name => !noTargetSales.has(name) && targetRows(month).some(row => row.level === "person" && row.name === name && Number(row.spend || 0) > 0))
    .sort((a, b) => `${salesTeams[a] || ""}${a}`.localeCompare(`${salesTeams[b] || ""}${b}`, "zh-CN"));
  const body = sales.map(name => {
    const day = sum(yRows.filter(r => r[cols["商务"]] === name));
    const targetRowsForSales = targetRows(month).filter(row => row.level === "person" && row.name === name);
    const target = targetRowsForSales.reduce((acc, row) => acc + Number(row.spend || 0), 0);
    const actual = targetRowsForSales.length
      ? targetRowsForSales.reduce((acc, row) => acc + sum(actualRowsForTarget(row.month, row.level, row.name, rows, targetBusiness(row))), 0)
      : sum(mRows.filter(r => r[cols["商务"]] === name));
    const stat = progressGap(actual, target, date);
    return `<tr><td>${esc(salesTeams[name] || "未分组")}</td><td>${esc(name)}</td><td class="num">${fmtWan(day)}w</td><td class="num">${fmtWan(actual)}w</td><td class="num">${fmtWan(target)}w</td><td class="num">${pctFmt.format(stat.complete)}%</td><td class="num ${stat.gap >= 0 ? "good" : "bad"}">${stat.gap >= 0 ? "+" : "-"}${pctFmt.format(Math.abs(stat.gap))}pct</td></tr>`;
  }).join("");
  $("dailySalesTable").innerHTML = `<thead><tr><th>商务组</th><th>商务</th><th class="num">昨日消耗</th><th class="num">月累消耗</th><th class="num">消耗目标</th><th class="num">目标完成</th><th class="num">与时间GAP</th></tr></thead><tbody>${body || `<tr><td colspan="7" class="empty">暂无商务数据</td></tr>`}</tbody>`;
}
function renderDailyRanks(yRows) {
  const localTop = group(bizRows(yRows, "本地推"), r => r[cols["项目"]] || r[cols["商机名称"]]).sort((a, b) => b.value - a.value).slice(0, 5);
  const operateTop = group(bizRows(yRows, "代运营"), r => r[cols["项目"]] || r[cols["商机名称"]]).sort((a, b) => b.value - a.value).slice(0, 5);
  $("dailyLocalTop").innerHTML = dailyRankList(localTop);
  $("dailyOperateTop").innerHTML = dailyRankList(operateTop);
}
function dailyRankList(items) {
  if (!items.length) return `<p class="empty small">暂无数据</p>`;
  const max = Math.max(...items.map(x => x.value), 1);
  return `<div class="dailyRankList">${items.map((x, i) => `<p><span>${i + 1}</span><b>${esc(x.label)}</b><i><em style="width:${x.value / max * 100}%"></em></i><strong>${fmtWan(x.value)}w</strong></p>`).join("")}</div>`;
}
function renderDailyVolatility(date) {
  const dates = [...new Set(localPushRows(rows).map(r => r[cols.date]).filter(d => d <= date))].sort().slice(-5);
  const source = localPushRows(rows).filter(r => dates.includes(r[cols.date]) && (isDirectRow(r) || isChannelRow(r)));
  const keys = [...new Set(source.map(r => `${isChannelRow(r) ? "渠道" : "直签"}|${r[cols["商机名称"]] || r[cols["项目"]]}`).filter(Boolean))];
  const items = keys.map(key => {
    const [type, name] = key.split("|");
    const values = dates.map(day => sum(source.filter(r => r[cols.date] === day && (r[cols["商机名称"]] || r[cols["项目"]]) === name)));
    let best = { value: 0, from: 0, to: 0, day: "" };
    for (let i = 1; i < values.length; i++) {
      const diff = values[i] - values[i - 1];
      const rate = values[i - 1] ? diff / values[i - 1] * 100 : (values[i] ? 100 : 0);
      if (Math.abs(rate) > Math.abs(best.value)) best = { value: rate, from: values[i - 1], to: values[i], day: dates[i] };
    }
    return { type, name, ...best };
  }).filter(x => x.to || x.from).sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).slice(0, 8);
  $("dailyVolatilityTable").innerHTML = `<thead><tr><th>类型</th><th>客户/渠道</th><th>波动日期</th><th class="num">前一日消耗</th><th class="num">当日消耗</th><th class="num">环比波动</th></tr></thead><tbody>${items.map(x => `<tr><td>${esc(x.type)}</td><td>${esc(x.name)}</td><td>${esc(x.day)}</td><td class="num">${fmtMoney(x.from)}</td><td class="num">${fmtMoney(x.to)}</td><td class="num ${x.value >= 0 ? "good" : "bad"}">${x.value >= 0 ? "+" : ""}${pctFmt.format(x.value)}%</td></tr>`).join("") || `<tr><td colspan="6" class="empty">近5日暂无明显波动数据</td></tr>`}</tbody>`;
}
function monthProgressFor(date) {
  const d = dateObj(date);
  const days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return d.getDate() / days * 100;
}
function progressRow(label, value, tone = "") {
  return `<div class="progressRow ${tone}"><span>${esc(label)}</span><strong>${pctFmt.format(value)}%</strong><div class="progressTrack"><i style="width:${Math.max(0, Math.min(100, value || 0))}%"></i></div></div>`;
}
function teamCompare(rows, monthRows, bizName = "本地推") {
  return ["销售一组", "销售二组"].map(team => {
    const day = sum(rows.filter(r => salesTeam(r) === team));
    const month = sum(monthRows.filter(r => salesTeam(r) === team));
    const target = targetFor(monthOf(monthRows[0]?.[cols.date] || $("endDate").value || dataDateMax(rows)), "team", team, bizName).spend || 0;
    return `<div class="teamLine"><span>${team}</span><b>昨日 ${fmtWan(day)}w</b><b>M月 ${fmtWan(month)}w</b><b>完成 ${fmtPct(month, target)}</b></div>`;
  }).join("");
}
function report(id, dayRows, monthRows, name, target, options = {}) {
  const topDirect = group(dayRows.filter(r => r[cols["客户类型"]] === "直签"), r => r[cols["项目"]] || r[cols["商机名称"]]).sort((a, b) => b.value - a.value).slice(0, 3);
  const topChannel = group(dayRows.filter(r => r[cols["客户类型"]] === "渠道"), r => r[cols["项目"]] || r[cols["商机名称"]]).sort((a, b) => b.value - a.value).slice(0, 3);
  const date = dayRows[0]?.[cols.date] || $("endDate").value || dataDateMax(rows);
  const timePct = monthProgressFor(date);
  const completePct = target ? sum(monthRows) / target * 100 : 0;
  const diff = completePct - timePct;
  $(id).innerHTML = `
    <p>昨日${name}消耗：<b>${fmtWan(sum(dayRows))}w</b></p>
    <p>M${Number(monthOf(date).slice(5))}${name}消耗：<b>${fmtWan(sum(monthRows))}w</b>｜目标 ${fmtWan(target)}w</p>
    <div class="progressCompare">
      ${progressRow("时间进度", timePct, "time")}
      ${progressRow("目标完成进度", completePct, diff >= 0 ? "ahead" : "behind")}
      <p class="${diff >= 0 ? "good" : "bad"}">${diff >= 0 ? "领先" : "落后"}时间进度 ${pctFmt.format(Math.abs(diff))}%</p>
    </div>
    ${options.showTeam ? `<hr><h4>销售一组 / 销售二组对比</h4><div class="teamCompare">${teamCompare(dayRows, monthRows, name)}</div>` : ""}
    <hr>
    <p>当前平均日耗：${fmtWan(avgDaily(monthRows))}w</p>
    <p>直签客户TOP3：${topText(topDirect)}</p>
    <p>渠道TOP3：${topText(topChannel)}</p>`;
}
function topText(items) { return items.length ? items.map(x => `${x.label}${fmtWan(x.value)}w`).join("、") : "暂无"; }

function detailRows() {
  return filtered.filter(row => row[cols["媒体端口"]] === "巨量-本地推");
}

function renderDetails() {
  const q = $("tableSearch").value.trim().toLowerCase();
  const detailSource = detailRows();
  const source = q ? detailSource.filter(row => row.some(v => `${v}`.toLowerCase().includes(q))) : detailSource.slice();
  source.sort((a, b) => {
    const av = a[sortState.col], bv = b[sortState.col];
    const n = Number(av) - Number(bv);
    const cmp = Number.isFinite(n) && `${av}` !== "" && `${bv}` !== "" ? n : `${av}`.localeCompare(`${bv}`, "zh-CN");
    return sortState.dir === "asc" ? cmp : -cmp;
  });
  const totalPages = Math.max(1, Math.ceil(source.length / pageSize));
  page = Math.min(page, totalPages);
  const pageRows = source.slice((page - 1) * pageSize, page * pageSize);
  const visibleCols = meta.columns.map((name, i) => ({ name, i })).filter(col => !["总消耗", "赠款消耗"].includes(col.name));
  const numeric = new Set(["非赠款消耗"]);
  $("detailTable").innerHTML = `<thead><tr>${visibleCols.map(col => `<th data-col="${col.i}" class="${numeric.has(col.name) ? "num" : ""}">${esc(col.name)}${sortState.col === col.i ? (sortState.dir === "asc" ? " ↑" : " ↓") : ""}</th>`).join("")}</tr></thead><tbody>${pageRows.map(r => `<tr>${visibleCols.map(col => `<td class="${numeric.has(col.name) ? "num" : ""}">${numeric.has(col.name) ? fmtMoney(r[col.i]) : esc(r[col.i])}</td>`).join("")}</tr>`).join("")}</tbody>`;
  $("tableInfo").textContent = `本地推｜当前 ${fmtMoney(source.length)} 行｜非赠款消耗 ${fmtWan(sum(source))}w`;
  $("pageInfo").textContent = `${page} / ${totalPages}`;
  $("prevPage").disabled = page <= 1;
  $("nextPage").disabled = page >= totalPages;
  document.querySelectorAll("#detailTable th").forEach(th => th.onclick = () => {
    const col = Number(th.dataset.col);
    sortState = { col, dir: sortState.col === col && sortState.dir === "asc" ? "desc" : "asc" };
    renderDetails();
  });
}

function targetOptions(level) {
  if (level === "business") return ["本地推", "代充值", "代运营"];
  if (level === "team") return ["销售一组", "销售二组"];
  return [...new Set(rows.map(r => r[cols["商务"]]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function refreshTargetNameOptions() {
  const level = $("targetLevel").value;
  const current = $("targetName").value;
  const options = targetOptions(level);
  $("targetName").innerHTML = options.map(name => `<option>${esc(name)}</option>`).join("");
  if (options.includes(current)) $("targetName").value = current;
  refreshTargetBizOptions();
  loadTargetEditorValues();
}

function refreshTargetBizOptions() {
  const targetBiz = $("targetBiz");
  if (!targetBiz) return;
  const level = $("targetLevel").value;
  const current = targetBiz.value;
  const options = ["本地推", "代充值", "代运营"];
  targetBiz.innerHTML = options.map(name => `<option>${esc(name)}</option>`).join("");
  if (level === "business") {
    targetBiz.value = $("targetName").value || "本地推";
    targetBiz.disabled = true;
    return;
  }
  targetBiz.disabled = false;
  targetBiz.value = options.includes(current) ? current : "本地推";
}

function loadTargetEditorValues() {
  const level = $("targetLevel").value;
  const name = $("targetName").value;
  const biz = level === "business" ? name : $("targetBiz").value;
  const row = targetFor($("targetMonth").value, level, name, biz);
  $("targetSpend").value = row.spend ? Math.round(row.spend / 10000) : "";
  $("targetNew").value = row.fresh || "";
}

function saveTarget() {
  const level = $("targetLevel").value;
  const name = $("targetName").value;
  const row = {
    month: $("targetMonth").value,
    level,
    name,
    biz: level === "business" ? "" : $("targetBiz").value,
    spend: Number($("targetSpend").value || 0) * 10000,
    fresh: Number($("targetNew").value || 0)
  };
  const targets = getTargets();
  targets[targetId(row)] = row;
  setTargets(targets);
  renderAll();
  refreshTargetNameOptions();
  $("saveTarget").textContent = "已保存";
  setTimeout(() => $("saveTarget").textContent = "保存目标", 1200);
}

function renderTargets() {
  if (!$("targetTable")) return;
  const month = $("targetMonth").value || monthOf($("endDate").value || dataDateMax(rows));
  const levelName = { business: "业务", team: "销售组", person: "商务个人" };
  const body = targetRows(month).map(row => {
    const biz = targetBusiness(row);
    const actualSpend = sum(actualRowsForTarget(row.month, row.level, row.name, rows, biz));
    const actualNew = actualNewForTarget(row.month, row.level, row.name, rows, true, biz);
    return `<tr>
      <td>${esc(row.month)}</td>
      <td>${levelName[row.level] || row.level}</td>
      <td>${esc(row.name)}</td>
      <td>${esc(biz)}</td>
      <td class="num">${fmtWan(row.spend)}w</td>
      <td class="num">${fmtWan(actualSpend)}w</td>
      <td>${fmtPct(actualSpend, row.spend)}</td>
      <td class="num">${fmtMoney(row.fresh)}</td>
      <td class="num">${fmtMoney(actualNew)}</td>
      <td>${fmtPct(actualNew, row.fresh)}</td>
    </tr>`;
  }).join("");
  $("targetTable").innerHTML = `<thead><tr><th>月份</th><th>层级</th><th>对象</th><th>目标业务</th><th class="num">消耗目标</th><th class="num">实际消耗</th><th>消耗完成</th><th class="num">新开目标</th><th class="num">实际新开</th><th>新开完成</th></tr></thead><tbody>${body || `<tr><td colspan="10" class="empty">暂无目标</td></tr>`}</tbody>`;
}

function customerFilterRowsForMonth(month, endLimit = "") {
  const biz = $("bizFilter").value;
  const type = $("typeFilter").value;
  return rows.filter(row => isLocalPushRow(row) && row[cols.monthKey] === month && (!endLimit || row[cols.date] <= endLimit) && (!biz || row[cols["合作模式-DOSS"]] === biz) && (!type || row[cols["客户类型"]] === type));
}
function monthM(month) {
  return `M${Number(month.slice(5, 7))}`;
}
function selfMapForMonth(month) {
  const map = new Map();
  const monthLabel = monthM(month);
  for (const r of payload.selfOperating) {
    if (r[selfCols["月份"]] !== monthLabel) continue;
    const name = r[selfCols["广告主公司名称"]];
    map.set(name, (map.get(name) || 0) + Number(r[selfCols["本月总消耗"]] || 0));
  }
  return map;
}
function deltaText(cur, prev, unit = "") {
  const delta = cur - prev;
  const sign = delta > 0 ? "+" : "";
  return `较上月同期 ${sign}${unit === "w" ? fmtWan(delta) : fmtMoney(delta)}${unit}`;
}
function samePeriodRows(month, day) {
  const maxDay = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  const endDay = Math.min(day, maxDay);
  return customerFilterRowsForMonth(month, `${month}-${String(endDay).padStart(2, "0")}`);
}
function firstSpendMonthForProject(project, year) {
  const hit = rows
    .filter(r => isLocalPushRow(r) && r[cols["项目"]] === project && r[cols.monthKey].startsWith(`${year}-`) && Number(r[cols["非赠款消耗"]] || 0) > 0)
    .sort((a, b) => a[cols.date].localeCompare(b[cols.date]))[0];
  return hit ? hit[cols["月份"]] : "-";
}
function renderCustomers() {
  const end = $("endDate").value || dataDateMax(rows);
  const curMonth = monthOf(end);
  const months = dataMonths(rows);
  const prevMonth = months[months.indexOf(curMonth) - 1] || months[0] || curMonth;
  const day = dateObj(end).getDate();
  const year = curMonth.slice(0, 4);
  const currentRows = customerFilterRowsForMonth(curMonth, end);
  const prevRows = samePeriodRows(prevMonth, day);
  const direct = currentRows.filter(isDirectRow);
  const channel = currentRows.filter(isChannelRow);
  const prevDirect = prevRows.filter(isDirectRow);
  const prevChannel = prevRows.filter(isChannelRow);
  const selfMap = selfMapForMonth(curMonth);
  $("customerMetrics").innerHTML = [
    metric("直签客户数量", uniqueCount(direct, r => r[cols["商机名称"]]), `${deltaText(uniqueCount(direct, r => r[cols["商机名称"]]), uniqueCount(prevDirect, r => r[cols["商机名称"]]))}｜消耗 ${fmtWan(sum(direct))}w`, "biz-local"),
    metric("渠道数量", uniqueCount(channel, r => r[cols["商机名称"]]), `${deltaText(uniqueCount(channel, r => r[cols["商机名称"]]), uniqueCount(prevChannel, r => r[cols["商机名称"]]))}｜消耗 ${fmtWan(sum(channel))}w`, "biz-recharge"),
    metric("直签主体数", uniqueCount(direct, r => r[cols["广告主主体"]]), `${deltaText(uniqueCount(direct, r => r[cols["广告主主体"]]), uniqueCount(prevDirect, r => r[cols["广告主主体"]]))}｜消耗环比 ${deltaText(sum(direct), sum(prevDirect), "w")}`, "biz-operate"),
    metric("渠道主体数", uniqueCount(channel, r => r[cols["广告主主体"]]), `${deltaText(uniqueCount(channel, r => r[cols["广告主主体"]]), uniqueCount(prevChannel, r => r[cols["广告主主体"]]))}｜消耗环比 ${deltaText(sum(channel), sum(prevChannel), "w")}`, "biz-new"),
  ].join("");
  const directAll = topProjects(direct, prevDirect, year, Number.MAX_SAFE_INTEGER);
  const channelAll = topProjects(channel, prevChannel, year, Number.MAX_SAFE_INTEGER);
  const directTop = directAll.slice(0, 10);
  const channelTop = channelAll.slice(0, 10);
  const currentMonthLabel = monthM(curMonth);
  renderRank("directTop", directTop);
  renderRank("channelTop", channelTop);
  renderRank("directFirstMonthTop", directAll.filter(x => x.firstMonth === currentMonthLabel).slice(0, 10), "暂无本月首消直签项目");
  renderRank("channelFirstMonthTop", channelAll.filter(x => x.firstMonth === currentMonthLabel).slice(0, 10), "暂无本月首消渠道项目");
  renderSalesCustomerMix(currentRows);
  renderCustomerChangeStats(curMonth, end, prevMonth);
  renderCustomerTable(currentRows, selfMap);
  renderCustomerLookup();
}
function topProjects(list, prevList, year, limit = 10) {
  const prev = new Map(group(prevList, r => r[cols["项目"]] || "未填写").map(x => [x.label, x.value]));
  return group(list, r => r[cols["项目"]] || "未填写")
    .sort((a, b) => b.value - a.value)
    .slice(0, limit)
    .map(x => ({ ...x, grade: grade(x.value), prev: prev.get(x.label) || 0, firstMonth: firstSpendMonthForProject(x.label, year) }));
}
function renderRank(id, items, emptyText = "暂无数据") {
  if (!$(id)) return;
  if (!items.length) {
    $(id).innerHTML = `<div class="empty">${esc(emptyText)}</div>`;
    return;
  }
  const max = Math.max(...items.map(x => x.value), 1);
  $(id).innerHTML = items.map(x => {
    const delta = x.value - x.prev;
    return `<div class="rankRow"><span>${esc(x.label)} <b class="grade ${x.grade}">${x.grade}</b><em>较上月同期 ${delta > 0 ? "+" : ""}${fmtWan(delta)}w｜首耗 ${esc(x.firstMonth || "-")}</em></span><div class="bar"><span style="width:${Math.max(2, x.value / max * 100)}%"></span></div><strong>${fmtWan(x.value)}w</strong></div>`;
  }).join("");
}
function renderSalesCustomerMix(list) {
  const sales = [...new Set(list.map(r => r[cols["商务"]]).filter(Boolean))].map(name => {
    const rowsForSales = list.filter(r => r[cols["商务"]] === name);
    const direct = rowsForSales.filter(isDirectRow);
    const channel = rowsForSales.filter(isChannelRow);
    return {
      name,
      directCount: uniqueCount(direct, r => r[cols["商机名称"]]),
      channelCount: uniqueCount(channel, r => r[cols["商机名称"]]),
      directSpend: sum(direct),
      channelSpend: sum(channel)
    };
  }).sort((a, b) => (b.directSpend + b.channelSpend) - (a.directSpend + a.channelSpend));
  chart("salesCustomerSpendChart", "bar", sales.map(x => x.name), [
    { label: "直签消耗", data: sales.map(x => x.directSpend), backgroundColor: palette.blue },
    { label: "渠道消耗", data: sales.map(x => x.channelSpend), backgroundColor: palette.green }
  ], { scales: { x: { stacked: true, grid: { color: palette.grid }, ticks: { color: palette.tick } }, y: { stacked: true, grid: { color: palette.grid }, ticks: { color: palette.tick, callback: v => `${fmtWan(v)}w` } } } });
  chart("salesCustomerCountChart", "bar", sales.map(x => x.name), [
    { label: "直签个数", data: sales.map(x => x.directCount), backgroundColor: palette.blue },
    { label: "渠道个数", data: sales.map(x => x.channelCount), backgroundColor: palette.green }
  ], { countAxis: true, scales: { x: { stacked: true, grid: { color: palette.grid }, ticks: { color: palette.tick } }, y: { stacked: true, grid: { color: palette.grid }, ticks: { color: palette.tick, precision: 0 } } } });
}
function newCustomerType(entry, labels = newLabels()) {
  const label = effectiveNewLabel(entry, labels);
  if (label === "存量商机" || label === "历史渠道新增主体") return "";
  if (label === "代充值新渠道") return "渠道";
  if (label === "代充值新客户" || label === "代运营新客户") return "直签";
  return entry.customerType === "渠道" ? "渠道" : entry.customerType === "直签" ? "直签" : "";
}
function customerChangeRows(curMonth, endDate, prevMonth) {
  const labels = newLabels();
  const currentRows = customerFilterRowsForMonth(curMonth, endDate);
  const currentByOpp = new Map(group(currentRows, r => r[cols["商机名称"]]).map(x => [x.label, x.value]));
  const newRows = baseNewEntriesForMonth(curMonth, endDate)
    .map(normalizeNewEntry)
    .filter(entry => entry.opportunity && !`${entry.key || ""}`.startsWith("channelSubject|"))
    .map(entry => ({
      change: "新增",
      type: newCustomerType(entry, labels),
      opportunity: entry.opportunity,
      sales: entry.sales || "",
      team: salesTeams[entry.sales] || "未分组",
      value: currentByOpp.get(entry.opportunity) || 0
    }))
    .filter(x => x.type);

  const monthStart = `${curMonth}-01`;
  const elapsedDays = dateObj(endDate).getDate();
  const cur = rows.filter(r => r[cols.monthKey] === curMonth && r[cols.date] >= monthStart && r[cols.date] <= endDate);
  const prev = rows.filter(r => r[cols.monthKey] === prevMonth);
  const curDirect = new Map(group(cur.filter(isDirectRow), r => r[cols["商机名称"]]).map(x => [x.label, x.value]));
  const curChannel = new Map(group(cur.filter(isChannelRow), r => r[cols["商机名称"]]).map(x => [x.label, x.value]));
  const lostRowsFor = (list, type, currentMap) => group(list, r => `${r[cols["商机名称"]]}|${r[cols["商务"]]}`)
    .filter(x => {
      const [opportunity] = x.label.split("|");
      return x.value > 0 && (currentMap.get(opportunity) || 0) === 0;
    })
    .map(x => {
      const [opportunity, sales] = x.label.split("|");
      return { change: "流失", type, opportunity, sales, team: salesTeams[sales] || "未分组", value: x.value };
    });
  const lostRows = elapsedDays > 10 ? [
    ...lostRowsFor(prev.filter(isDirectRow), "直签", curDirect),
    ...lostRowsFor(prev.filter(isChannelRow), "渠道", curChannel)
  ] : [];
  return [...newRows, ...lostRows];
}
function aggregateCustomerChanges(list, keyFn) {
  const buckets = new Map();
  for (const row of list) {
    const key = keyFn(row) || "未填写";
    if (!buckets.has(key)) {
      buckets.set(key, {
        key,
        directNewCount: 0,
        directNewSpend: 0,
        channelNewCount: 0,
        channelNewSpend: 0,
        directLostCount: 0,
        directLostSpend: 0,
        channelLostCount: 0,
        channelLostSpend: 0
      });
    }
    const item = buckets.get(key);
    const prefix = row.type === "渠道" ? "channel" : "direct";
    const middle = row.change === "新增" ? "New" : "Lost";
    item[`${prefix}${middle}Count`] += 1;
    item[`${prefix}${middle}Spend`] += row.value;
  }
  return [...buckets.values()];
}
function renderCustomerChangeTable(id, rows, nameLabel) {
  if (!$(id)) return;
  const body = rows.map(x => `<tr>
    <td>${esc(x.key)}</td>
    <td class="num">${fmtMoney(x.directNewCount)}</td><td class="num">${fmtWan(x.directNewSpend)}w</td>
    <td class="num">${fmtMoney(x.channelNewCount)}</td><td class="num">${fmtWan(x.channelNewSpend)}w</td>
    <td class="num">${fmtMoney(x.directLostCount)}</td><td class="num">${fmtWan(x.directLostSpend)}w</td>
    <td class="num">${fmtMoney(x.channelLostCount)}</td><td class="num">${fmtWan(x.channelLostSpend)}w</td>
  </tr>`).join("");
  $(id).innerHTML = `<thead><tr><th>${esc(nameLabel)}</th><th class="num">直签新增</th><th class="num">新增消耗</th><th class="num">渠道新增</th><th class="num">新增消耗</th><th class="num">直签流失</th><th class="num">上月消耗</th><th class="num">渠道流失</th><th class="num">上月消耗</th></tr></thead><tbody>${body || `<tr><td colspan="9" class="empty">暂无新增或流失数据</td></tr>`}</tbody>`;
}
function renderCustomerChangeStats(curMonth, endDate, prevMonth) {
  const changes = customerChangeRows(curMonth, endDate, prevMonth);
  renderCustomerChangeTable("customerChangeSummaryTable", aggregateCustomerChanges(changes, x => x.type), "类型");
  renderCustomerChangeTable("teamCustomerChangeTable", aggregateCustomerChanges(changes, x => x.team).sort((a, b) => (b.directNewSpend + b.channelNewSpend + b.directLostSpend + b.channelLostSpend) - (a.directNewSpend + a.channelNewSpend + a.directLostSpend + a.channelLostSpend)), "商务组");
  renderCustomerChangeTable("salesCustomerChangeTable", aggregateCustomerChanges(changes, x => x.sales).sort((a, b) => (b.directNewSpend + b.channelNewSpend + b.directLostSpend + b.channelLostSpend) - (a.directNewSpend + a.channelNewSpend + a.directLostSpend + a.channelLostSpend)), "商务");
}
function renderCustomerTable(list, selfMap) {
  const by = group(list, r => `${r[cols["客户类型"]]}|${r[cols["商机名称"]]}|${r[cols["项目"]]}`);
  const rowsOut = by.sort((a, b) => b.value - a.value).slice(0, 120).map(item => {
    const [type, name, project] = item.label.split("|");
    const subRows = list.filter(r => r[cols["商机名称"]] === name);
    const subjects = [...new Set(subRows.map(r => r[cols["广告主主体"]]).filter(Boolean))];
    const bodies = subjects.length;
    const selfSpend = subjects.reduce((acc, subject) => acc + (selfMap.get(subject) || 0), 0);
    return `<tr><td>${type}</td><td>${esc(project)}</td><td>${esc(name)}</td><td class="num">${bodies}</td><td class="num">${fmtWan(item.value)}w</td><td><span class="grade ${grade(item.value)}">${grade(item.value)}</span></td><td class="num">${fmtWan(selfSpend)}w</td></tr>`;
  });
  $("customerTable").innerHTML = `<thead><tr><th>类型</th><th>项目</th><th>客户/渠道</th><th class="num">主体数</th><th class="num">非赠款消耗</th><th>等级</th><th class="num">自运营消耗</th></tr></thead><tbody>${rowsOut.join("")}</tbody>`;
}
function renderCustomerLookup() {
  if (!$("customerLookupTable")) return;
  const keyword = ($("customerLookupInput").value || "").trim();
  if (!keyword) {
    $("customerLookupTable").innerHTML = `<tbody><tr><td class="empty">输入主体或商机名称后查询归属关系和当月消耗</td></tr></tbody>`;
    return;
  }
  const end = $("endDate").value || dataDateMax(rows);
  const month = monthOf(end);
  const monthRows = customerFilterRowsForMonth(month, end);
  const allMatches = localPushRows(rows).filter(r => `${r[cols["广告主主体"]]}`.includes(keyword) || `${r[cols["商机名称"]]}`.includes(keyword) || `${r[cols["项目"]]}`.includes(keyword));
  const subjectMatches = allMatches.filter(r => `${r[cols["广告主主体"]]}`.includes(keyword));
  const opportunityMatches = allMatches.filter(r => `${r[cols["商机名称"]]}`.includes(keyword) || `${r[cols["项目"]]}`.includes(keyword));
  const lines = [];
  const seenSubject = new Set();
  for (const item of group(subjectMatches, r => `${r[cols["广告主主体"]]}|${r[cols["商机名称"]]}|${r[cols["客户类型"]]}|${r[cols["项目"]]}|${r[cols["商务"]]}`, null)) {
    const [subject, opportunity, type, project, sales] = item.label.split("|");
    const key = `subject|${subject}|${opportunity}`;
    if (seenSubject.has(key)) continue;
    seenSubject.add(key);
    const spend = sum(monthRows.filter(r => r[cols["广告主主体"]] === subject && r[cols["商机名称"]] === opportunity));
    lines.push({ kind: "主体归属", subject, opportunity, type, project, sales, spend });
  }
  const seenOppSubject = new Set();
  for (const item of group(opportunityMatches, r => `${r[cols["商机名称"]]}|${r[cols["客户类型"]]}|${r[cols["项目"]]}|${r[cols["商务"]]}`, null)) {
    const [opportunity, type, project, sales] = item.label.split("|");
    const relatedSubjects = [...new Set(localPushRows(rows).filter(r => r[cols["商机名称"]] === opportunity).map(r => r[cols["广告主主体"]]).filter(Boolean))];
    for (const subject of relatedSubjects) {
      const key = `opportunity|${opportunity}|${subject}`;
      if (seenOppSubject.has(key)) continue;
      seenOppSubject.add(key);
      const spend = sum(monthRows.filter(r => r[cols["商机名称"]] === opportunity && r[cols["广告主主体"]] === subject));
      lines.push({ kind: "商机关联主体", subject, opportunity, type, project, sales, spend });
    }
  }
  lines.sort((a, b) => b.spend - a.spend);
  $("customerLookupTable").innerHTML = `<thead><tr><th>查询类型</th><th>主体</th><th>归属商机</th><th>直签/渠道</th><th>项目</th><th>商务</th><th class="num">当月非赠款消耗</th></tr></thead><tbody>${lines.map(x => `<tr><td>${esc(x.kind)}</td><td>${esc(x.subject)}</td><td>${esc(x.opportunity)}</td><td>${esc(x.type)}</td><td>${esc(x.project)}</td><td>${esc(x.sales)}</td><td class="num">${fmtWan(x.spend)}w</td></tr>`).join("") || `<tr><td colspan="7" class="empty">未找到相关主体或商机</td></tr>`}</tbody>`;
}

function buildNewEntries(data) {
  const historicalOppSpend = new Map(group(rows, r => r[cols["商机名称"]]).map(x => [x.label, x.value]));
  const historicalChannelSubjectSpend = new Map(group(rows.filter(isChannelRow), r => `${r[cols["商机名称"]]}|${r[cols["广告主主体"]]}`).map(x => [x.label, x.value]));
  const seen = new Set();
  const entries = [];
  for (const rawRow of data) {
    const row = canonicalUploadRow(rawRow);
    const opportunity = row["商机名称"] || "";
    const subject = row["广告主主体"] || "";
    const sales = row["商务"] || "";
    const biz = row["合作模式-DOSS"] || "";
    const project = row["项目"] || "";
    const type = row["客户类型"] || "";
    const belong = row["归属类别"] || "";
    const channel = isChannelType(type, belong);
    const direct = isDirectType(type, belong);
    if (opportunity && (historicalOppSpend.get(opportunity) || 0) <= 0) {
      const key = `opportunity|${opportunity}`;
      if (!seen.has(key)) {
        seen.add(key);
        entries.push({
          key,
          opportunity,
          subject,
          sales,
          biz,
          customerType: channel ? "渠道" : direct ? "直签" : type || "未识别",
          kind: channel ? "渠道新增" : direct ? "直签客户新增" : "历史无消耗商机",
          labelKey: opportunity,
          project,
          port: row["媒体端口"] || "",
          defaultLabel: channel ? "代充值新渠道" : biz === "代运营" ? "代运营新客户" : direct ? "代充值新客户" : "存量商机"
        });
      }
    }
    if (channel && opportunity && subject && (historicalChannelSubjectSpend.get(`${opportunity}|${subject}`) || 0) <= 0) {
      const key = `channelSubject|${opportunity}|${subject}`;
      if (!seen.has(key)) {
        seen.add(key);
        entries.push({
          key,
          opportunity,
          subject,
          sales,
          biz,
          project,
          port: row["媒体端口"] || "",
          customerType: "渠道",
          kind: "历史渠道新增主体",
          labelKey: key,
          defaultLabel: "历史渠道新增主体"
        });
      }
    }
  }
  return entries;
}
function normalizeNewEntry(item) {
  if (typeof item === "string") return { key: `opportunity|${item}`, opportunity: item, subject: "", project: "", sales: "", biz: "", customerType: "未识别", kind: "历史无消耗商机", labelKey: item, defaultLabel: "存量商机" };
  return { ...item, project: item.project || "", labelKey: item.labelKey || item.opportunity };
}
function baseNewEntriesForMonth(month, endDate, sourceRows = rows) {
  const monthRows = sourceRows.filter(r => r[cols.monthKey] === month && (!endDate || r[cols.date] <= endDate));
  const historyRows = sourceRows.filter(r => r[cols.monthKey] < month);
  const historicalOppSpend = new Map(group(historyRows, r => r[cols["商机名称"]]).map(x => [x.label, x.value]));
  const historicalChannelSubjectSpend = new Map(group(historyRows.filter(isChannelRow), r => `${r[cols["商机名称"]]}|${r[cols["广告主主体"]]}`).map(x => [x.label, x.value]));
  const seen = new Set();
  const entries = [];
  for (const row of monthRows) {
    const opportunity = row[cols["商机名称"]] || "";
    const subject = row[cols["广告主主体"]] || "";
    const sales = row[cols["商务"]] || "";
    const biz = row[cols["合作模式-DOSS"]] || "";
    const project = row[cols["项目"]] || "";
    const port = row[cols["媒体端口"]] || "";
    const channel = isChannelRow(row);
    const direct = isDirectRow(row);
    if (opportunity && (historicalOppSpend.get(opportunity) || 0) <= 0) {
      const key = `opportunity|${opportunity}`;
      if (!seen.has(key)) {
        seen.add(key);
        entries.push({
          key,
          opportunity,
          subject,
          sales,
          biz,
          project,
          port,
          customerType: channel ? "渠道" : direct ? "直签" : "未识别",
          kind: channel ? "渠道新增" : direct ? "直签客户新增" : "历史无消耗商机",
          labelKey: opportunity,
          defaultLabel: channel ? "代充值新渠道" : biz === "代运营" ? "代运营新客户" : direct ? "代充值新客户" : "存量商机"
        });
      }
    }
    if (channel && opportunity && subject && (historicalChannelSubjectSpend.get(`${opportunity}|${subject}`) || 0) <= 0) {
      const key = `channelSubject|${opportunity}|${subject}`;
      if (!seen.has(key)) {
        seen.add(key);
        entries.push({
          key,
          opportunity,
          subject,
          sales,
          biz,
          project,
          port,
          customerType: "渠道",
          kind: "历史渠道新增主体",
          labelKey: key,
          defaultLabel: "历史渠道新增主体"
        });
      }
    }
  }
  return entries.sort((a, b) => `${a.kind}${a.opportunity}`.localeCompare(`${b.kind}${b.opportunity}`, "zh-CN"));
}

function renderChanges() {
  const endDate = $("endDate").value || dataDateMax(rows);
  const endMonth = monthOf(endDate);
  const months = dataMonths(rows);
  const prevMonth = months[months.indexOf(endMonth) - 1] || months[0] || endMonth;
  const monthStart = `${endMonth}-01`;
  const elapsedDays = dateObj(endDate).getDate();
  const cur = rows.filter(r => r[cols.monthKey] === endMonth && r[cols.date] >= monthStart && r[cols.date] <= endDate);
  const prev = rows.filter(r => r[cols.monthKey] === prevMonth);
  const curDirect = new Map(group(cur.filter(isDirectRow), r => r[cols["商机名称"]]).map(x => [x.label, x.value]));
  const curChannel = new Map(group(cur.filter(isChannelRow), r => r[cols["商机名称"]]).map(x => [x.label, x.value]));
  const curChannelSubject = new Map(group(cur.filter(isChannelRow), r => `${r[cols["商机名称"]]}|${r[cols["广告主主体"]]}`).map(x => [x.label, x.value]));
  lostRows = elapsedDays > 10 ? [
    ...group(prev.filter(isDirectRow), r => r[cols["商机名称"]])
      .filter(x => x.value > 0 && (curDirect.get(x.label) || 0) === 0)
      .map(x => ({ kind: "直签客户流失", opportunity: x.label, subject: "", value: x.value })),
    ...group(prev.filter(isChannelRow), r => r[cols["商机名称"]])
      .filter(x => x.value > 0 && (curChannel.get(x.label) || 0) === 0)
      .map(x => ({ kind: "渠道流失", opportunity: x.label, subject: "", value: x.value })),
    ...group(prev.filter(isChannelRow), r => `${r[cols["商机名称"]]}|${r[cols["广告主主体"]]}`)
      .filter(x => x.value > 0 && (curChannelSubject.get(x.label) || 0) === 0)
      .map(x => {
        const [opportunity, subject] = x.label.split("|");
        return { kind: "渠道主体流失", opportunity, subject, value: x.value };
      })
  ].sort((a, b) => b.value - a.value) : [];
  lostElapsedDays = elapsedDays;
  renderLostTable();
  const latest = uploadHistory()[0];
  const baseNew = baseNewEntriesForMonth(endMonth, endDate);
  renderUploadedNew([...baseNew, ...((latest?.newOpportunities || []).filter(entryAllowed))]);
  renderUploadHistory();
}
function renderLostTable() {
  if (!$("lostTable")) return;
  const type = $("lostTypeFilter")?.value || "";
  const keyword = ($("lostSearch")?.value || "").trim();
  const list = lostRows.filter(x => (!type || x.kind === type) && (!keyword || `${x.opportunity}${x.subject}`.includes(keyword)));
  const total = list.reduce((acc, x) => acc + x.value, 0);
  const directCount = list.filter(x => x.kind === "直签客户流失").length;
  const channelCount = list.filter(x => x.kind === "渠道流失").length;
  const subjectCount = list.filter(x => x.kind === "渠道主体流失").length;
  $("lostSummary").innerHTML = [
    `筛选后数量 <b>${fmtMoney(list.length)}</b>`,
    `上月消耗合计 <b>${fmtWan(total)}w</b>`,
    `直签客户 <b>${fmtMoney(directCount)}</b>`,
    `渠道 <b>${fmtMoney(channelCount)}</b>`,
    `渠道主体 <b>${fmtMoney(subjectCount)}</b>`
  ].join("<span>|</span>");
  $("lostTable").innerHTML = `<thead><tr><th>类型</th><th>客户/渠道</th><th>主体</th><th class="num">上月消耗</th><th class="num">本月0消耗天数</th></tr></thead><tbody>${list.map(x => `<tr><td>${esc(x.kind)}</td><td>${esc(x.opportunity)}</td><td>${esc(x.subject || "-")}</td><td class="num">${fmtWan(x.value)}w</td><td class="num">${lostElapsedDays}天</td></tr>`).join("") || `<tr><td colspan="5" class="empty">当前暂无符合规则的流失客户、渠道或渠道主体</td></tr>`}</tbody>`;
}
function renderUploadedNew(items) {
  const labels = newLabels();
  const projects = newProjects();
  const seen = new Set();
  const newItems = items.filter(Boolean).map(normalizeNewEntry).filter(item => {
    const key = item.key || item.labelKey || item.opportunity;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const options = ["存量商机", "代充值新客户", "代运营新客户", "代充值新渠道", "历史渠道新增主体"];
  const opportunityItems = newItems.filter(x => !`${x.key || ""}`.startsWith("channelSubject|"));
  const subjectItems = newItems.filter(x => `${x.key || ""}`.startsWith("channelSubject|"));
  const editableCells = x => {
    const key = x.labelKey;
    const projectDefault = x.project || "未填写";
    const datalistId = projectDatalistId(key);
    return `
      <td>
        <input class="newProjectSelect projectSuggest" list="${esc(datalistId)}" data-name="${esc(key)}" data-default="${esc(projectDefault)}" placeholder="输入项目名称" />
        <datalist id="${esc(datalistId)}">${projectOptions(projectDefault).map(opt => `<option value="${esc(opt)}"></option>`).join("")}</datalist>
      </td>
      <td>${esc(x.sales || "-")}</td>
      <td><select class="newSelect" data-name="${esc(key)}" data-default="${esc(x.defaultLabel || "存量商机")}">${options.map(opt => `<option>${esc(opt)}</option>`).join("")}</select></td>`;
  };
  if ($("newOpportunityTable")) {
    $("newOpportunityTable").innerHTML = `<thead><tr><th>自动识别类型</th><th>客户/渠道</th><th>项目</th><th>商务</th><th>真实类型</th></tr></thead><tbody>${opportunityItems.map(x => `<tr>
      <td>${esc(x.kind)}</td>
      <td>${esc(x.opportunity)}</td>
      ${editableCells(x)}
    </tr>`).join("") || `<tr><td colspan="5" class="empty">本月暂无可新增识别的商机</td></tr>`}</tbody>`;
  }
  if ($("newSubjectTable")) {
    $("newSubjectTable").innerHTML = `<thead><tr><th>自动识别类型</th><th>主体</th><th>归属商机</th><th>项目</th><th>商务</th><th>真实类型</th></tr></thead><tbody>${subjectItems.map(x => `<tr>
      <td>${esc(x.kind)}</td>
      <td>${esc(x.subject || "-")}</td>
      <td>${esc(x.opportunity)}</td>
      ${editableCells(x)}
    </tr>`).join("") || `<tr><td colspan="6" class="empty">本月暂无可新增识别的主体</td></tr>`}</tbody>`;
  }
  document.querySelectorAll(".newSelect").forEach(s => { s.value = labels[s.dataset.name] || s.dataset.default || "存量商机"; });
  document.querySelectorAll(".newProjectSelect").forEach(s => { s.value = projects[s.dataset.name] || s.dataset.default || "未填写"; });
}

function saveNewLabelSelections() {
  const labels = newLabels();
  document.querySelectorAll(".newSelect").forEach(s => labels[s.dataset.name] = s.value);
  setNewLabels(labels);
  const projects = newProjects();
  document.querySelectorAll(".newProjectSelect").forEach(s => projects[s.dataset.name] = s.value);
  setNewProjects(projects);
  rebuildAllRows();
  rows = scopedRowsFor(currentUser);
  applyFilters();
  for (const id of ["saveNewLabels", "saveNewLabelsInChanges"]) {
    const btn = $(id);
    if (!btn) continue;
    const text = btn.textContent;
    btn.textContent = "已保存";
    setTimeout(() => btn.textContent = text, 1200);
  }
}

function renderUploadHistory() {
  if (!isAdmin()) {
    $("uploadHistoryTable").innerHTML = `<tbody><tr><td class="empty">仅管理员可查看上传历史</td></tr></tbody>`;
    return;
  }
  const history = uploadHistory();
  const body = history.map((item, index) => `<tr>
    <td>${esc(item.uploadedAt)}</td>
    <td>${esc(item.fileName)}</td>
    <td class="num">${fmtMoney(item.rowCount)}</td>
    <td class="num">${fmtMoney(item.newOpportunities.length)}</td>
    <td><button class="downloadUploadItem" data-index="${index}">下载</button></td>
  </tr>`).join("");
  $("uploadHistoryTable").innerHTML = `<thead><tr><th>上传时间</th><th>文件名</th><th class="num">行数</th><th class="num">新增商机数</th><th>操作</th></tr></thead><tbody>${body || `<tr><td colspan="5" class="empty">暂无上传历史</td></tr>`}</tbody>`;
  document.querySelectorAll(".downloadUploadItem").forEach(btn => btn.onclick = () => {
    const item = uploadHistory()[Number(btn.dataset.index)];
    downloadCsv(item.columns || [], item.rows || [], `上传历史-${item.fileName || item.uploadedAt}.csv`);
  });
}

function downloadCsv(headers, bodyRows, filename) {
  const csv = [headers, ...bodyRows].map(row => row.map(v => `"${`${v ?? ""}`.replaceAll('"', '""')}"`).join(",")).join("\n");
  const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
function exportCsv() {
  const visibleCols = meta.columns.map((name, i) => ({ name, i })).filter(col => !["总消耗", "赠款消耗"].includes(col.name));
  downloadCsv(visibleCols.map(col => col.name), detailRows().map(row => visibleCols.map(col => row[col.i])), `本地推非赠款消耗明细-${Date.now()}.csv`);
}
function downloadUploadedHistory() {
  if (!isAdmin()) return;
  const history = uploadHistory();
  const allRows = history.flatMap(item => (item.rows || []).map(row => [item.uploadedAt, item.fileName, ...row]));
  const headers = ["上传时间", "文件名", ...((history[0] && history[0].columns) || [])];
  downloadCsv(headers, allRows, `上传历史数据-${Date.now()}.csv`);
}
function renderAll() { renderDashboard(); renderPublicity(); renderReports(); renderDetails(); renderTargets(); renderCustomers(); renderChanges(); }

function init() {
  const minDate = dataDateMin(allRows);
  const maxDate = dataDateMax(allRows);
  const months = dataMonths(rows);
  $("dataMeta").textContent = `数据范围 ${minDate} 至 ${maxDate}｜生成于 ${meta.generatedAt}｜当前权限 ${currentUser.scopeLabel}｜可见 ${fmtMoney(rows.length)} 行`;
  $("startDate").value = maxDate.slice(0, 7) + "-01";
  $("endDate").value = maxDate;
  for (const biz of [...new Set(allRows.map(r => r[cols["合作模式-DOSS"]]))]) $("bizFilter").insertAdjacentHTML("beforeend", `<option>${esc(biz)}</option>`);
  $("targetMonth").innerHTML = months.map(month => `<option>${esc(month)}</option>`).join("");
  $("targetMonth").value = monthOf(maxDate);
  refreshTargetNameOptions();
  document.querySelectorAll(".nav[data-panel]").forEach(btn => btn.onclick = () => {
    if ((btn.classList.contains("adminOnly") || btn.classList.contains("restrictedOnly")) && !isAdmin()) return;
    if (btn.classList.contains("userOnly") && isAdmin()) return;
    document.querySelectorAll(".nav").forEach(x => x.classList.remove("active"));
    btn.classList.add("active");
    document.body.classList.toggle("my-dashboard-active", btn.dataset.panel === "myDashboard");
    document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
    $(btn.dataset.panel === "myDashboard" ? "dashboard" : btn.dataset.panel).classList.add("active");
    if (btn.dataset.panel === "dashboard" || btn.dataset.panel === "myDashboard") renderDashboard();
    if (btn.dataset.panel === "publicity") renderPublicity();
  });
  $("applyFilters").onclick = applyFilters;
  $("resetFilters").onclick = () => { const max = dataDateMax(allRows); $("startDate").value = max.slice(0, 7) + "-01"; $("endDate").value = max; $("bizFilter").value = ""; $("typeFilter").value = ""; applyFilters(); };
  $("tableSearch").oninput = () => { page = 1; renderDetails(); };
  $("prevPage").onclick = () => { page--; renderDetails(); };
  $("nextPage").onclick = () => { page++; renderDetails(); };
  $("exportCsv").onclick = exportCsv;
  $("targetMonth").onchange = () => { loadTargetEditorValues(); renderTargets(); };
  $("targetLevel").onchange = refreshTargetNameOptions;
  $("targetName").onchange = () => { refreshTargetBizOptions(); loadTargetEditorValues(); };
  $("targetBiz").onchange = loadTargetEditorValues;
  $("saveTarget").onclick = saveTarget;
  $("customerLookupBtn").onclick = renderCustomerLookup;
  $("customerLookupInput").onkeydown = e => { if (e.key === "Enter") renderCustomerLookup(); };
  $("customerLookupClear").onclick = () => { $("customerLookupInput").value = ""; renderCustomerLookup(); };
  $("lostTypeFilter").onchange = renderLostTable;
  $("lostSearch").oninput = renderLostTable;
  $("lostClear").onclick = () => { $("lostTypeFilter").value = ""; $("lostSearch").value = ""; renderLostTable(); };
  $("downloadBaseHistory").onclick = () => downloadCsv(meta.columns, rows, `原始历史数据-${Date.now()}.csv`);
  $("downloadUploadedHistory").onclick = downloadUploadedHistory;
  $("saveNewLabels").onclick = saveNewLabelSelections;
  $("saveNewLabelsInChanges").onclick = saveNewLabelSelections;
  $("uploadFile").onchange = async e => {
    if (!isAdmin()) return;
    const file = e.target.files[0];
    if (!file || !window.XLSX) return;
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array", cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    const columns = data.length ? Object.keys(data[0]) : [];
    const bodyRows = data.map(row => columns.map(col => row[col]));
    const newItems = buildNewEntries(data);
    const history = uploadHistory();
    history.unshift({
      uploadedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
      fileName: file.name,
      rowCount: data.length,
      newOpportunities: newItems,
      columns,
      rows: bodyRows
    });
    setUploadHistory(history.slice(0, 20));
    rebuildAllRows();
    rows = scopedRowsFor(currentUser);
    const max = dataDateMax(allRows);
    $("startDate").value = max.slice(0, 7) + "-01";
    $("endDate").value = max;
    $("dataMeta").textContent = `数据范围 ${dataDateMin(allRows)} 至 ${max}｜生成于 ${meta.generatedAt}｜当前权限 ${currentUser.scopeLabel}｜可见 ${fmtMoney(rows.length)} 行`;
    applyFilters();
    e.target.value = "";
  };
  applyFilters();
}
function bootstrap() {
  const user = savedAuthUser();
  if (!user) {
    showLogin();
    return;
  }
  applyAuth(user);
  init();
}
bootstrap();
