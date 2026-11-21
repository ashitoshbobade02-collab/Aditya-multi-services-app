import { db, auth } from "./firebase.js";
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  onSnapshot,
  collection,
  getDocs,
  updateDoc
} from "https://www.gstatic.com/firebasejs/13.3.0/firebase-firestore.js";

import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  onAuthStateChanged,
  signOut,
  linkWithPopup
} from "https://www.gstatic.com/firebasejs/13.3.0/firebase-auth.js";

const KEY = "aditya_multi_services_v3";
const THEME_KEY = "aditya_multi_services_theme_v1";

function togglePasswordVisibility() {
  const passwordInput = document.getElementById("loginPassword");
  const toggleButton = document.querySelector(".password-toggle");

  if (passwordInput.type === "password") {
    passwordInput.type = "text";
    toggleButton.textContent = "HIDE";
  } else {
    passwordInput.type = "password";
    toggleButton.textContent = "SHOW";
  }
}

const emptyData = () => ({
  days: [],
  currentDay: null,
  walletCarryForward: null,
  customers: [],
  deletedEntries: [],
  numberSteps: {
    opening: 10,
    wallet: 1,
    transaction: 10,
    service: 1,
    closing: 1,
    withdrawal: 1,
    payment: 10,
    ledger: 1
  },
  dashboardVisibility: {
    biznext: true,
    roinet: true,
    tez: true,
    fino: true,
    sbi: true,
    cashBalance: true,
    onlineBalance: true,
    todayBusiness: true,
    todayTransactions: true,
    todayServices: true,
    todayWithdrawals: true,
    cashNetProfit: true,
    onlineNetProfit: true,
    totalNetProfit: true,
    businessChart: true
  }
});

let data = emptyData();
let currentUser = null;
let activeStorageKey = null;
let cloudWriteQueue = Promise.resolve();
let unsubscribeCloudListener = null;
let calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let selectedHistoryDate = today();


function normalizeData(value) {
  const clean = value && typeof value === "object" ? value : emptyData();

  if (!Array.isArray(clean.days)) clean.days = [];
  if (!Array.isArray(clean.customers)) clean.customers = [];
  if (!Array.isArray(clean.deletedEntries)) clean.deletedEntries = [];
  if (!Object.prototype.hasOwnProperty.call(clean, "currentDay")) clean.currentDay = null;
  if (!Object.prototype.hasOwnProperty.call(clean, "walletCarryForward")) clean.walletCarryForward = null;

  const defaults = emptyData();

  clean.numberSteps = {
    ...defaults.numberSteps,
    ...(clean.numberSteps || {})
  };

  clean.dashboardVisibility = {
    ...defaults.dashboardVisibility,
    ...(clean.dashboardVisibility || {})
   };
  return clean;
}


function getDaySessions(day) {
  if (!day) return [];

  // New format: one date containing multiple sessions
  if (Array.isArray(day.sessions)) {
    return day.sessions;
  }

  // Old format: preserve existing business-day records
  return [day];
}

function money(value) {
  return "₹" + Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}


function renderNumberStepSettings() {
  const steps = data.numberSteps || emptyData().numberSteps;

  const fields = {
    opening: "stepOpening",
    wallet: "stepWallet",
    transaction: "stepTransaction",
    service: "stepService",
    closing: "stepClosing",
    withdrawal: "stepWithdrawal",
    payment: "stepPayment",
    ledger: "stepLedger"
  };

  Object.entries(fields).forEach(([key, id]) => {
    const input = document.getElementById(id);
    if (input) input.value = steps[key];
  });
}


const dashboardVisibilityItems = {
  wallet: [
    ["biznext", "sectionBiznext", "Biznext Wallet"],
    ["roinet", "sectionRoinet", "Roinet Wallet"],
    ["tez", "sectionTez", "Tez Wallet"],
    ["fino", "sectionFino", "Fino Wallet"],
    ["sbi", "sectionSbi", "SBI Wallet"]
  ],
  today: [
    ["cashBalance", "sectionCashBalance", "Cash Balance"],
    ["onlineBalance", "sectionOnlineBalance", "Online Balance"],
    ["todayBusiness", "sectionTodayBusiness", "Today's Business"],
    ["todayTransactions", "sectionTodayTransactions", "Today's Total Transactions"],
    ["todayServices", "sectionTodayServices", "Today's Total Services"],
    ["todayWithdrawals", "sectionTodayWithdrawals", "Today's Total Withdrawals"],
    ["cashNetProfit", "sectionCashNetProfit", "Cash Net Profit"],
    ["onlineNetProfit", "sectionOnlineNetProfit", "Online Net Profit"],
    ["totalNetProfit", "sectionTotalNetProfit", "Total Net Profit"],
    ["businessChart", "sectionBusinessChart", "7-Day Business Performance"]
  ]
};

function renderDashboardVisibilitySettings() {
  const visibility = data.dashboardVisibility || {};
  
  const renderItems = (items) => items.map(([key, id, label]) => `
    <label style="display:flex;align-items:center;gap:10px;margin:10px 0;">
      <input type="checkbox"
        ${visibility[key] !== false ? "checked" : ""}
        onchange="updateDashboardVisibility('${key}', this.checked)">
      ${label}
    </label>
  `).join("");

  document.getElementById("walletVisibilitySettings").innerHTML =
    renderItems(dashboardVisibilityItems.wallet);

  document.getElementById("todayVisibilitySettings").innerHTML =
    renderItems(dashboardVisibilityItems.today);
}

function applyDashboardVisibility() {
  const visibility = data.dashboardVisibility || {};

  Object.values(dashboardVisibilityItems).flat().forEach(([key, id]) => {
    const element = document.getElementById(id);
    if (element) {
      element.style.display = visibility[key] === false ? "none" : "";
    }
  });
}

function updateDashboardVisibility(key, visible) {
  data.dashboardVisibility[key] = visible;
  persist();
  applyDashboardVisibility();

  const message = document.getElementById("dashboardVisibilitySaveMessage");
  if (message) message.textContent = "Saved successfully.";
}

function updateNumberStep(key, value) {
  const amount = Number(value);

  if (!Number.isFinite(amount) || amount <= 0) {
    renderNumberStepSettings();
    return;
  }

  data.numberSteps = data.numberSteps || emptyData().numberSteps;
  data.numberSteps[key] = amount;
  persist();

  const message = document.getElementById("numberStepSaveMessage");
  if (message) message.textContent = "Saved successfully.";
}

function setupNumberWheelSteps() {
  const fieldSettings = {
    openingCash: "opening",
    openingOnline: "opening",
    openingBiznext: "wallet",
    openingRoinet: "wallet",
    openingTez: "wallet",
    openingFino: "wallet",
    openingSbi: "wallet",
    transactionAmount: "transaction",
    serviceDirectAmount: "service",
    serviceCashAmount: "service",
    serviceOnlineAmount: "service",
    actualCash: "closing",
    withdrawalAmount: "withdrawal"
  };

  document.addEventListener("wheel", event => {
    const input = event.target;

    if (
      !input ||
      input.tagName !== "INPUT" ||
      input.type !== "number" ||
      document.activeElement !== input
    ) return;

    let key = fieldSettings[input.id];

    if (input.id === "customerPaymentAmount") {
      key = ["received", "given"].includes(customerPaymentMode)
        ? "payment"
        : "ledger";
    }

    if (!key) return;

    const step = Number(data.numberSteps?.[key]) || 1;
    if (input.readOnly || input.disabled) return;

    event.preventDefault();

    const direction = event.deltaY < 0 ? 1 : -1;
    const current = Number(input.value) || 0;
    const min = input.min === "" ? -Infinity : Number(input.min);
    const max = input.max === "" ? Infinity : Number(input.max);

    const next = Math.min(
      max,
      Math.max(min, current + direction * step)
    );

    input.value = String(Number(next.toFixed(2)));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, { passive: false });
}

function today() {
  const d = new Date();
  return d.getFullYear() + "-" +
    String(d.getMonth() + 1).padStart(2, "0") + "-" +
    String(d.getDate()).padStart(2, "0");
}

function toggleCustomReportDates() {
  const type = document.getElementById("reportType").value;
  const dates = document.getElementById("customReportDates");

  dates.style.display = type === "custom" ? "block" : "none";
}

function getReportDays(startDate, endDate) {
  const dailyRecords = new Map();

  (data.days || []).forEach(day => {
    dailyRecords.set(day.date, {
      date: day.date,
      sessions: [...getDaySessions(day)]
    });
  });

  if (data.currentDay) {
    const date = data.currentDay.date;
    const existing = dailyRecords.get(date);

    if (existing) {
      existing.sessions.push(data.currentDay);
    } else {
      dailyRecords.set(date, {
        date,
        sessions: [data.currentDay]
      });
    }
  }

  return [...dailyRecords.values()]
    .filter(day => day.date >= startDate && day.date <= endDate)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function generateReport() {
  const type = document.getElementById("reportType").value;
  const todayDate = today();
  let startDate = todayDate;
  let endDate = todayDate;

  if (type === "weekly") {
    const date = new Date(todayDate + "T00:00:00");
    const day = date.getDay();
    date.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
    startDate = date.getFullYear() + "-" +
  String(date.getMonth() + 1).padStart(2, "0") + "-" +
  String(date.getDate()).padStart(2, "0");

    const end = new Date(date);
    end.setDate(end.getDate() + 6);
    endDate = end.getFullYear() + "-" +
  String(end.getMonth() + 1).padStart(2, "0") + "-" +
  String(end.getDate()).padStart(2, "0");
  }

  if (type === "monthly") {
    startDate = todayDate.slice(0, 7) + "-01";
    const date = new Date(
      Number(todayDate.slice(0, 4)),
      Number(todayDate.slice(5, 7)),
      0
    );
    endDate = date.getFullYear() + "-" +
      String(date.getMonth() + 1).padStart(2, "0") + "-" +
      String(date.getDate()).padStart(2, "0");
  }

  if (type === "custom") {
    startDate = document.getElementById("reportStartDate").value;
    endDate = document.getElementById("reportEndDate").value;

    if (!startDate || !endDate || startDate > endDate) {
      showCustomPopup(
        "Invalid Dates",
        "Please select a valid date range.",
        "error"
      );
      return;
    }
  }

  const days = getReportDays(startDate, endDate);
  const result = document.getElementById("reportResult");

  if (!days.length) {
  window.currentReportData = null;
  result.innerHTML = "<p>No business records found for this period.</p>";
  return;
}
  const totals = {
    cashProfit: 0,
    onlineProfit: 0,
    profit: 0,
    cashNetProfit: 0,
    onlineNetProfit: 0,
    netProfit: 0,
    expenses: 0
  };

  const rows = days.map(day => {
    const t = calculateDailyTotals(day);

    Object.keys(totals).forEach(key => {
      totals[key] += Number(t[key]) || 0;
    });

    return `
      <tr>
        <td>${day.date}</td>
        <td>${money(t.cashProfit)}</td>
        <td>${money(t.onlineProfit)}</td>
        <td>${money(t.profit)}</td>
        <td>${money(t.netProfit)}</td>
      </tr>
    `;
  }).join("");

  window.currentReportData = {
    startDate,
    endDate,
    days,
    totals
  };
  document.getElementById("reportPopupSummary").innerHTML = `
    <h3>Business Report</h3>
    <p>Period: ${startDate} to ${endDate}</p>

    <p>Cash Profit: <strong>${money(totals.cashProfit)}</strong></p>
    <p>Online Profit: <strong>${money(totals.onlineProfit)}</strong></p>
    <p>Total Profit: <strong>${money(totals.profit)}</strong></p>
    <p>Cash Net Profit: <strong>${money(totals.cashNetProfit)}</strong></p>
    <p>Online Net Profit: <strong>${money(totals.onlineNetProfit)}</strong></p>
    <p>Total Expenses: <strong>${money(totals.expenses)}</strong></p>
    <p>Total Net Profit: <strong>${money(totals.netProfit)}</strong></p>

    <h3>Daily Breakdown</h3>
    <div style="overflow-x:auto;">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Cash Profit</th>
            <th>Online Profit</th>
            <th>Total Profit</th>
            <th>Net Profit</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
    document.getElementById("reportPopupPeriod").textContent =
    `${startDate} to ${endDate}`;
  document.getElementById("reportPopup").style.display = "flex";
}

function closeReportPopup() {
  document.getElementById("reportPopup").style.display = "none";
}

function exportExcel() {
  const report = window.currentReportData;

  if (!report || !report.days.length) {
    showCustomPopup("No Report", "Generate a report first.", "error");
    return;
  }

  if (typeof XLSX === "undefined") {
    showCustomPopup("Excel Unavailable", "Excel library did not load. Check your internet connection.", "error");
    return;
  }

  const wb = XLSX.utils.book_new();
  const addSheet = (name, rows) => {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, name);
  };

  const summary = [
    ["ADITYA MULTI SERVICES - BUSINESS REPORT"],
    ["From", report.startDate],
    ["To", report.endDate],
    [],
    ["Profit Summary", "Amount"],
    ["Cash Profit", report.totals.cashProfit],
    ["Online Profit", report.totals.onlineProfit],
    ["Total Profit", report.totals.profit],
    ["Cash Net Profit", report.totals.cashNetProfit],
    ["Online Net Profit", report.totals.onlineNetProfit],
    ["Total Expenses", report.totals.expenses],
    ["Total Net Profit", report.totals.netProfit]
  ];

  const transactions = [
    ["Date", "Time", "Type", "Amount", "Charge", "Charge Payment", "Platform"]
  ];

  const expenses = [
    ["Date", "Time", "Category", "Payment Method", "Amount", "Note"]
  ];
 
  const movements = [
    ["Date", "Time", "Account", "Movement", "Amount", "Note"]
  ];

  const cashOnline = [
    ["Date", "Cash Profit", "Online Profit", "Total Profit",
     "Cash Expenses", "Online Expenses", "Cash Net Profit",
     "Online Net Profit", "Total Net Profit", "Expected Cash",
     "Actual Cash", "Cash Difference", "Expected Online",
     "Actual Online", "Online Difference"]
  ];

  const wallets = [
    ["Date", "Biznext", "Roinet", "Tez", "Fino", "SBI"]
  ];

report.days.forEach(day => {
  const sessions = getDaySessions(day);

  sessions.forEach(session => {
    (session.transactions || []).forEach(t => {
      transactions.push([
        day.date, t.time || "", t.type || "", t.amount || 0,
        t.charge || 0, t.chargePaymentMethod || "CASH",
        t.platform || ""
      ]);
    });

    (session.expenses || []).forEach(e => {
      expenses.push([
        day.date, e.time || "", e.category || "",
        e.paymentMethod || "CASH", e.amount || 0, e.note || ""
      ]);
    });
  
  (session.cashMovements || []).forEach(m => {
  movements.push([
    day.date,
    m.time || "",
    m.account || "CASH",
    m.type || "",
    m.amount || 0,
    m.note || ""
       ]);
     });
   });

  const t = calculateDailyTotals(day);
  const lastSession = sessions[sessions.length - 1];
  const c = lastSession?.closing || {};

  cashOnline.push([
    day.date, t.cashProfit, t.onlineProfit, t.profit,
    t.cashExpenses, t.onlineExpenses, t.cashNetProfit,
    t.onlineNetProfit, t.netProfit, t.cash,
    c.actualCash ?? "", c.difference ?? "",
    t.online, c.actualOnline ?? "", c.onlineDifference ?? ""
  ]);

  wallets.push([
    day.date, t.biznext, t.roinet, t.tez, t.fino, t.sbi
  ]);
});
  
  addSheet("Summary", summary);
  addSheet("Transactions", transactions);
  addSheet("Expenses", expenses);
  addSheet("Cash & Online Movements", movements);
  addSheet("Cash & Online", cashOnline);
  addSheet("Wallet Balances", wallets);

  XLSX.writeFile(wb, "Aditya-Multi-Services-Report.xlsx");
}

function exportPDF() {
  const report = window.currentReportData;

  if (!report || !report.days.length) {
    showCustomPopup("No Report", "Generate a report first.", "error");
    return;
  }

  if (!window.jspdf || !window.jspdf.jsPDF) {
    showCustomPopup("PDF Unavailable", "PDF library did not load. Check your internet connection.", "error");
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF("p", "mm", "a4");
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;
  const pdfMoney = value =>
  "Rs. " + (Number(value) || 0).toFixed(2);

  const addFooter = () => {
    const pageCount = doc.internal.getNumberOfPages();

    for (let page = 1; page <= pageCount; page++) {
      doc.setPage(page);
      doc.setFontSize(8);
      doc.text(
        `Aditya Multi Services | Page ${page} of ${pageCount}`,
        pageWidth / 2,
        290,
        { align: "center" }
      );
    }
  };

  doc.setFontSize(18);
  doc.text("ADITYA MULTI SERVICES", pageWidth / 2, 17, {
    align: "center"
  });

  doc.setFontSize(13);
  doc.text("BUSINESS REPORT", pageWidth / 2, 25, {
    align: "center"
  });

  doc.setFontSize(10);
  doc.text(
    `Report Period: ${report.startDate} to ${report.endDate}`,
    margin,
    34
  );

  const summaryRows = [
    ["Cash Profit", report.totals.cashProfit],
    ["Online Profit", report.totals.onlineProfit],
    ["Total Profit", report.totals.profit],
    ["Cash Net Profit", report.totals.cashNetProfit],
    ["Online Net Profit", report.totals.onlineNetProfit],
    ["Total Expenses", report.totals.expenses],
    ["Total Net Profit", report.totals.netProfit]
  ];

  doc.autoTable({
    startY: 40,
    head: [["Profit Summary", "Amount (INR)"]],
    body: summaryRows.map(r => [r[0], pdfMoney(r[1])]),
    margin: { left: margin, right: margin },
    theme: "grid"
  });

  let y = doc.lastAutoTable.finalY + 10;

  const transactionRows = [];
  const expenseRows = [];
  const movementRows = [];
  const dailyRows = [];
  const walletRows = [];
  
report.days.forEach(day => {
  const sessions = getDaySessions(day);

  sessions.forEach(session => {
    (session.transactions || []).forEach(item => {
      transactionRows.push([
        day.date,
        item.time || "",
        item.type || "",
        pdfMoney(item.amount || 0),
        pdfMoney(item.charge || 0),
        item.chargePaymentMethod || "CASH",
        item.platform || ""
      ]);
    });

    (session.expenses || []).forEach(item => {
      expenseRows.push([
        day.date,
        item.time || "",
        item.category || "",
        item.paymentMethod || "CASH",
        pdfMoney(item.amount || 0),
        item.note || ""
      ]);
  });

  (session.cashMovements || []).forEach(item => {
  movementRows.push([
    day.date,
    item.time || "",
    item.account || "CASH",
    item.type || "",
    pdfMoney(item.amount || 0),
    item.note || ""
    ]);
  });
});    

  const t = calculateDailyTotals(day);
  const lastSession = sessions[sessions.length - 1];
  const c = lastSession?.closing || {};

  dailyRows.push([
    day.date,
    pdfMoney(t.cashProfit),
    pdfMoney(t.onlineProfit),
    pdfMoney(t.profit),
    pdfMoney(t.cashNetProfit),
    pdfMoney(t.onlineNetProfit),
    pdfMoney(t.netProfit)
  ]);

  walletRows.push([
    day.date,
    pdfMoney(t.biznext),
    pdfMoney(t.roinet),
    pdfMoney(t.tez),
    pdfMoney(t.fino),
    pdfMoney(t.sbi),
    pdfMoney(t.cash),
    pdfMoney(t.online),
    c.actualCash == null ? "Not closed" : pdfMoney(c.actualCash),
    c.actualOnline == null ? "Not closed" : pdfMoney(c.actualOnline)
  ]);
});
  
  const addTable = (title, head, body) => {
    if (y > 265) {
      doc.addPage();
      y = 18;
    }

    doc.setFontSize(12);
    doc.text(title, margin, y);

    doc.autoTable({
      startY: y + 4,
      head: [head],
      body: body.length ? body : [["No records"]],
      margin: { left: margin, right: margin },
      theme: "grid",
      styles: {
        fontSize: 7,
        cellPadding: 2,
        overflow: "linebreak"
      },
      headStyles: {
        fontSize: 7
      },
      rowPageBreak: "avoid"
    });

    y = doc.lastAutoTable.finalY + 10;
  };

  addTable(
    "Daily Profit Breakdown",
    ["Date", "Cash Profit", "Online Profit", "Total Profit",
     "Cash Net", "Online Net", "Total Net"],
    dailyRows
  );

  addTable(
    "Transaction Details",
    ["Date", "Time", "Type", "Amount", "Charge", "Charge Paid By", "Platform"],
    transactionRows
  );
  
  addTable(
    "Expense Details",
    ["Date", "Time", "Category", "Paid By", "Amount", "Note"],
    expenseRows
  );
  
  addTable(
    "Cash & Online Movements",
    ["Date", "Time", "Account", "Movement", "Amount", "Note"],
     movementRows
  );

  addTable(
    "Cash, Online and Wallet Closing Summary",
    ["Date", "Biznext", "Roinet", "Tez", "Fino", "SBI",
     "Expected Cash", "Expected Online", "Actual Cash", "Actual Online"],
    walletRows
  );

  if (y > 245) {
    doc.addPage();
    y = 35;
  } else {
    y += 12;
  }

  doc.setFontSize(11);
  doc.text("Prepared By: ____________________", margin, y);
  doc.text("Signature: ____________________", margin, y + 12);
  doc.text("Date: ____________________", pageWidth - margin, y + 12, {
    align: "right"
  });

  addFooter();

  doc.save("Aditya-Multi-Services-Report.pdf");
}

function persist() {
  if (!currentUser || !activeStorageKey) return;
  const snapshot = JSON.stringify(data);
  localStorage.setItem(activeStorageKey, snapshot);
  renderTodayCompleteHistory();
  const userId = currentUser.uid;
  cloudWriteQueue = cloudWriteQueue
    .then(() => setDoc(doc(db, "users", userId, "appData", "main"), {
      data: JSON.parse(snapshot),
      updatedAt: serverTimestamp()
    }))
    .catch(error => {
      console.error("Cloud save failed:", error);
      showLoginMessage("Saved on this device. Cloud sync failed: " + (error.message || "Please check your connection."));
    });
 }

function moveToDeletedHistory(entry, type, source) {
  if (!entry) return;

  const day = currentDay();
  data.deletedEntries = data.deletedEntries || [];

  const originalDate = entry.date || day?.date || today();
  const businessDate = day?.date || entry.date || today();
  const sessionNumber = day?.sessionNumber || null;

  const existing = data.deletedEntries.find(item =>
    item.deletedType === type &&
    item.deletedFrom === source &&
    String(item.id) === String(entry.id) &&
    String(item.customerId || "") === String(entry.customerId || "") &&
    String(item.businessDate || "") === String(businessDate) &&
    String(item.sessionNumber || "") === String(sessionNumber || "")
  );

  const now = new Date();

  if (existing) {
    existing.deletionEvents = existing.deletionEvents || [];
    existing.deletionEvents.push({
      deletedAt: now.toLocaleString("en-IN"),
      deletedTimestamp: now.toISOString()
    });
    existing.restoredAt = null;
    existing.deletedAt = now.toLocaleString("en-IN");
    existing.deletedTimestamp = now.toISOString();
  } else {
    data.deletedEntries.push({
      ...JSON.parse(JSON.stringify(entry)),
      deletedId: Date.now() + Math.random(),
      deletedType: type,
      deletedFrom: source,
      originalDate,
      originalTime: entry.time || "Not available",
      businessDate,
      sessionNumber,
      deletedAt: now.toLocaleString("en-IN"),
      deletedTimestamp: now.toISOString(),
      deletionEvents: [{
        deletedAt: now.toLocaleString("en-IN"),
        deletedTimestamp: now.toISOString()
      }]
    });
  }
}

function syncOpeningWalletFields() {
  const carry = data.walletCarryForward;

  const fields = {
   biznext: "openingBiznext",
   roinet: "openingRoinet",
   tez: "openingTez",
   fino: "openingFino",
   sbi: "openingSbi"
  };

  Object.entries(fields).forEach(([key, id]) => {
    const input = document.getElementById(id);

    if (carry) {
      input.value = carry[key];
      input.readOnly = true;
      input.title = "Automatically carried forward from previous day";
    } else {
      input.readOnly = false;
      input.title = "";
    }
  });
}

function startBusinessDay() {
  if (data.currentDay) {
    alert("A business day is already running.");
    return;
  }

  syncOpeningWalletFields();

  const carry = data.walletCarryForward;

  const opening = {
    cash: Number(document.getElementById("openingCash").value),
    online: Number(document.getElementById("openingOnline").value),
    biznext: carry
      ? Number(carry.biznext)
      : Number(document.getElementById("openingBiznext").value),
    roinet: carry
      ? Number(carry.roinet)
      : Number(document.getElementById("openingRoinet").value),
    tez: carry
      ? Number(carry.tez)
      : Number(document.getElementById("openingTez").value),
    fino: carry
      ? Number(carry.fino)
      : Number(document.getElementById("openingFino").value),
    sbi: carry
      ? Number(carry.sbi)
      : Number(document.getElementById("openingSbi").value)
  };

  const cashValue = document.getElementById("openingCash").value.trim();
const onlineValue = document.getElementById("openingOnline").value.trim();

if (cashValue === "" || onlineValue === "") {
  showCustomPopup(
    "Missing Opening Balance",
    "Please enter both Cash and Online opening amounts. Enter 0 if the balance is zero.",
    "error"
  );
  return;
}

if (Object.values(opening).some(v => !Number.isFinite(v) || v < 0)) {
  showCustomPopup("Invalid Balance", "Please enter valid opening balances.", "error");
  return;
}

 const todayDate = today();

const existingIndex = (data.days || []).findIndex(
  savedDay => savedDay.date === todayDate
);

if (existingIndex !== -1) {
  const existingRecord = data.days[existingIndex];

  // Preserve all previously closed sessions.
  data.days[existingIndex] = {
    date: todayDate,
    sessions: getDaySessions(existingRecord)
  };

  // Start a fresh session with the newly entered balances.
  data.currentDay = {
    date: todayDate,
    sessionNumber: data.days[existingIndex].sessions.length + 1,
    opening,
    transactions: [],
    cashMovements: [],
    expenses: [],
    closed: false,
    closing: null
  };
} else {
  data.currentDay = {
    date: todayDate,
    sessionNumber: 1,
    opening,
    transactions: [],
    cashMovements: [],
    expenses: [],
    closed: false,
    closing: null
  };
}

  persist();
  refreshDashboard();
  openAppScreen("home");
  alert("Business day started successfully!");
}

function currentDay() {
  return data.currentDay;
}

function chargeFor(amount) {
  if (amount <= 0) return 0;
  return Math.ceil(amount / 1000) * 10;
}

function updateTransactionFields() {
  const type = document.getElementById("transactionType").value;

  document.getElementById("platformSection").style.display =
    type === "AEPS" ? "block" : "none";

  calculateChargePreview();
}

function calculateChargePreview() {
  const type = document.getElementById("transactionType").value;
  const amount =
    Number(document.getElementById("transactionAmount").value) || 0;

  const charge = ["AEPS", "C+", "C-"].includes(type)
    ? chargeFor(amount)
    : 0;

  document.getElementById("customerCharge").value = charge;
  document.getElementById("chargePreview").textContent =
    "Customer charge: " + money(charge);
}

/* ==================================
   SERVICES MANAGEMENT
================================== */

const SERVICE_DETAILS = {
  BW_PRINT: {
    name: "Black & White Print",
    rate: 10,
    unit: "pages",
    label: "Number of Pages"
  },
  COLOR_PRINT: {
    name: "Colour Print",
    rate: 20,
    unit: "pages",
    label: "Number of Pages"
  },
  XEROX: {
    name: "Xerox",
    rate: 5,
    unit: "copies",
    label: "Number of Copies"
  },
  PASSPORT_PHOTO: {
    name: "Passport Photo (8 photos per set)",
    rate: 50,
    unit: "sets",
    label: "Number of Sets (8 Photos Each)"
  },
  AADHAAR_LAMINATION: {
    name: "Aadhaar Card with Lamination",
    rate: 100,
    unit: "cards",
    label: "Number of Cards"
  },
  A4_LAMINATION: {
    name: "A4 Lamination",
    rate: 30,
    unit: "sheets",
    label: "Number of Sheets"
  }
};

function updateServiceFields() {
  const type = document.getElementById("serviceType").value;
  const mode = document.getElementById("serviceEntryMode").value;

  const quantitySection =
    document.getElementById("serviceQuantitySection");

  const idSection =
    document.getElementById("idLaminationSection");

  const otherSection =
    document.getElementById("otherServiceSection");

  const directSection =
    document.getElementById("directAmountSection");

  const quantityLabel =
    document.getElementById("serviceQuantityLabel");

  const isOther = type === "OTHER_SERVICE";
  const isID = type === "ID_LAMINATION";
  const isDirect = mode === "direct";

  quantitySection.style.display =
    isDirect || isOther ? "none" : "block";

  idSection.style.display =
    isID && !isDirect ? "block" : "none";

  otherSection.style.display = isOther ? "block" : "none";
  directSection.style.display = isDirect ? "block" : "none";

  if (SERVICE_DETAILS[type]) {
    quantityLabel.textContent = SERVICE_DETAILS[type].label;
  } else if (isID) {
    quantityLabel.textContent = "Number of Cards";
  }

  calculateServiceTotal();
}

function calculateServiceTotal() {
  const type = document.getElementById("serviceType").value;
  const mode = document.getElementById("serviceEntryMode").value;

  let total = 0;

  if (mode === "direct") {
    total =
      Number(document.getElementById("serviceDirectAmount").value) || 0;
  } else if (type === "OTHER_SERVICE") {
    total = 0;
  } else {
    const quantity =
      Number(document.getElementById("serviceQuantity").value) || 0;

    let rate = 0;

    if (SERVICE_DETAILS[type]) {
      rate = SERVICE_DETAILS[type].rate;
    }

    if (type === "ID_LAMINATION") {
      rate = Number(
        document.getElementById("idLaminationPrice").value
      );
    }

    if (Number.isInteger(quantity) && quantity > 0) {
      total = rate * quantity;
    }
  }

  document.getElementById("serviceTotal").value =
    total > 0 ? total : "";

  document.getElementById("serviceTotalPreview").textContent =
    money(total);

  calculateServiceSplit();
}

function updateServicePaymentFields() {
  const method =
    document.getElementById("servicePaymentMethod").value;

  const splitSection =
    document.getElementById("serviceSplitSection");

  splitSection.style.display =
    method === "Split" ? "block" : "none";

  if (method !== "Split") {
    document.getElementById("serviceCashAmount").value = "";
    document.getElementById("serviceOnlineAmount").value = "";
  }

  calculateServiceSplit();
}

function calculateServiceSplit() {
  const total =
    Number(document.getElementById("serviceTotal").value) || 0;

  const cash =
    Number(document.getElementById("serviceCashAmount").value) || 0;

  const online =
    Number(document.getElementById("serviceOnlineAmount").value) || 0;

  const difference =
    Math.round((total - cash - online) * 100) / 100;

  const preview =
    document.getElementById("serviceSplitPreview");

  if (!preview) return;

  if (difference === 0 && total > 0) {
    preview.textContent = "Payment matched successfully.";
  } else if (difference < 0) {
    preview.textContent =
      "Extra payment entered: " + money(Math.abs(difference));
  } else {
    preview.textContent =
      "Remaining amount: " + money(difference);
  }
}

function addServiceTransaction() {
  const day = currentDay();

  if (!day || day.closed) {
    alert("Start a business day first.");
    return;
  }

  const type = document.getElementById("serviceType").value;
  const mode = document.getElementById("serviceEntryMode").value;

  const amount =
    Number(document.getElementById("serviceTotal").value);

  if (!Number.isFinite(amount) || amount <= 0) {
    alert("Enter a valid service amount.");
    return;
  }

  const method =
    document.getElementById("servicePaymentMethod").value;

  let cashAmount = 0;
  let onlineAmount = 0;

  if (method === "Cash") {
    cashAmount = amount;
  } else if (method === "Online") {
    onlineAmount = amount;
  } else if (method === "Split") {
    cashAmount =
      Number(document.getElementById("serviceCashAmount").value) || 0;

    onlineAmount =
      Number(document.getElementById("serviceOnlineAmount").value) || 0;

    const paid = Math.round((cashAmount + onlineAmount) * 100) / 100;
    const expected = Math.round(amount * 100) / 100;

    if (cashAmount < 0 || onlineAmount < 0 || paid !== expected) {
      alert("Cash and Online amounts must equal the service total.");
      return;
    }
  }

  let serviceName = "";

  if (type === "OTHER_SERVICE") {
    serviceName =
      document.getElementById("otherServiceDescription").value.trim();

    if (!serviceName) {
      alert("Enter the service description.");
      return;
    }
  } else if (type === "ID_LAMINATION") {
    serviceName = "ID Card Lamination";
  } else {
    serviceName = SERVICE_DETAILS[type].name;
  }

  const quantity =
    mode === "quantity"
      ? Number(document.getElementById("serviceQuantity").value) || 0
      : null;

  const transaction = {
    id: Date.now(),
    time: new Date().toLocaleTimeString("en-IN", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit"
}),
timestamp: new Date().toISOString(),
    type: "SERVICE",
    serviceType: type,
    serviceName,
    entryMode: mode,
    quantity,
    rate: mode === "quantity"
      ? type === "ID_LAMINATION"
        ? Number(document.getElementById("idLaminationPrice").value)
        : SERVICE_DETAILS[type]?.rate || null
      : null,
    amount,
    charge: 0,
    paymentMethod: method,
    cashAmount,
    onlineAmount
  };

  day.transactions.push(transaction);
  persist();

  document.getElementById("serviceQuantity").value = 1;
  document.getElementById("serviceDirectAmount").value = "";
  document.getElementById("otherServiceDescription").value = "";
  document.getElementById("serviceCashAmount").value = "";
  document.getElementById("serviceOnlineAmount").value = "";

  document.getElementById("serviceType").value = "BW_PRINT";
  document.getElementById("serviceEntryMode").value = "quantity";
  document.getElementById("servicePaymentMethod").value = "Cash";

  updateServiceFields();
  updateServicePaymentFields();

  refreshDashboard();

  showCustomPopup(
  "Service Saved!",
  "Your service entry has been recorded successfully.",
  "success",
  `<div style="padding:12px;background:#f1f6fc;border-radius:10px;">
    <strong>Service:</strong> ${escapeLedgerHTML(serviceName)}
    <br>
    <strong>Amount:</strong> ${money(amount)}
  </div>`
);
}

/* ==================================
   BUSINESS CALCULATIONS
================================== */

function calculateTotals(day) {
    const opening = day.opening || {};
  const transactions = Array.isArray(day.transactions)
    ? day.transactions
    : [];
  const totals = {
    biznext: opening.biznext || 0,
    roinet: opening.roinet || 0,
    tez: opening.tez || 0,
    fino: opening.fino || 0,
    sbi: opening.sbi || 0,
    aeps: 0,
    cash: opening.cash,
    online: opening.online,
    profit: 0,
    cashProfit: 0,
    onlineProfit: 0,
    cashExpenses: 0,
    onlineExpenses: 0,
    cashNetProfit: 0,
    onlineNetProfit: 0,
    expenses: 0,
    netProfit: 0,
    business: 0,
    charges: 0,
    serviceIncome: 0
  };

  transactions.forEach(t => {
    const amount = Number(t.amount) || 0;
    const charge = Number(t.charge) || 0;

    if (t.type !== "ONLINE_WITHDRAWAL") {
      totals.business += amount;
    }

    if (t.type === "AEPS") {
      totals.aeps += amount;

      if (t.platform === "Biznext") totals.biznext += amount;
      if (t.platform === "Roinet") totals.roinet += amount;
      if (t.platform === "Tez") totals.tez += amount;
      if (t.platform === "Fino") totals.fino += amount;
      if (t.platform === "SBI") totals.sbi += amount;

      totals.cash -= amount;
    }

    if (t.type === "ONLINE_WITHDRAWAL") {
      if (t.platform === "Biznext") totals.biznext -= amount;
      if (t.platform === "Roinet") totals.roinet -= amount;
      if (t.platform === "Tez") totals.tez -= amount;
      if (t.platform === "Fino") totals.fino -= amount;
      if (t.platform === "SBI") totals.sbi -= amount;
    }

    if (t.type === "C+") {
      totals.cash += amount;
      totals.online -= amount;
    }

    if (t.type === "C-") {
      totals.cash -= amount;
      totals.online += amount;
    }

    if (["PRINT", "XEROX", "OTHER"].includes(t.type)) {
      totals.cash += amount;
    }

    if (t.type === "SERVICE") {
      const cashReceived = Number(t.cashAmount) || 0;
      const onlineReceived = Number(t.onlineAmount) || 0;

      totals.cash += cashReceived;
      totals.online += onlineReceived;
      totals.serviceIncome += amount;
      totals.profit += amount;
      totals.cashProfit += cashReceived;
      totals.onlineProfit += onlineReceived;
    }

   const chargeAccount = t.chargePaymentMethod || "CASH";

if (chargeAccount === "ONLINE") {
  totals.online += charge;
  totals.onlineProfit += charge;
} else {
  totals.cash += charge;
  totals.cashProfit += charge;
}

totals.charges += charge;
totals.profit += charge;
  });

 (day.cashMovements || []).forEach(entry => {
  const amount = Number(entry.amount) || 0;
  const account = entry.account || "CASH";
  const balanceKey = account === "ONLINE" ? "online" : "cash";

  if (entry.type === "IN") totals[balanceKey] += amount;
  if (entry.type === "OUT") totals[balanceKey] -= amount;
});


(day.expenses || []).forEach(expense => {
  const amount = Number(expense.amount) || 0;
  const paymentMethod = expense.paymentMethod || "CASH";

  if (paymentMethod === "CASH") {
    totals.cash -= amount;
    totals.cashExpenses += amount;
  }

  if (paymentMethod === "ONLINE") {
    totals.online -= amount;
    totals.onlineExpenses += amount;
  }
});
  
  totals.expenses = (day.expenses || []).reduce(
    (sum, expense) => sum + (Number(expense.amount) || 0),
    0
  );

totals.cashNetProfit =
  totals.cashProfit - totals.cashExpenses;

totals.onlineNetProfit =
  totals.onlineProfit - totals.onlineExpenses;

totals.netProfit =
  totals.profit - totals.expenses;

  return totals;

}

function calculateDailyTotals(day) {
  const sessions = getDaySessions(day);

  if (!sessions.length) return calculateTotals(day);

  const totals = calculateTotals(sessions[0]);

  const sumFields = [
    "aeps",
    "business",
    "profit",
    "cashProfit",
    "onlineProfit",
    "cashExpenses",
    "onlineExpenses",
    "cashNetProfit",
    "onlineNetProfit",
    "expenses",
    "netProfit",
    "charges",
    "serviceIncome"
  ];

  sumFields.forEach(field => {
    totals[field] = 0;
  });

  sessions.forEach(session => {
    const sessionTotals = calculateTotals(session);

    sumFields.forEach(field => {
      totals[field] += Number(sessionTotals[field]) || 0;
    });
  });

  // Keep the final session's actual balances.
  const lastSession = sessions[sessions.length - 1];
  const lastTotals = calculateTotals(lastSession);

  ["cash", "online", "biznext", "roinet", "tez", "fino", "sbi"]
    .forEach(field => {
      totals[field] = lastTotals[field];
    });

  return totals;
}

function saveCashMovement(account = "CASH") {
  const day = currentDay();

  if (!day || day.closed) {
    showCustomPopup("Shop Closed", "Start a business day first.", "error");
    return;
  }

  const isCash = account === "CASH";

  const type = document.getElementById(
    isCash ? "cashMovementType" : "onlineMovementType"
  ).value;

  const amount = Number(document.getElementById(
    isCash ? "cashMovementAmount" : "onlineMovementAmount"
  ).value);

  const note = document.getElementById(
    isCash ? "cashMovementNote" : "onlineMovementNote"
  ).value.trim();

  if (!Number.isFinite(amount) || amount <= 0) {
    showCustomPopup("Invalid Amount", "Enter a valid amount.", "error");
    return;
  }

  const totals = calculateTotals(day);
  const available = isCash ? totals.cash : totals.online;

  if (type === "OUT" && amount > available) {
    showCustomPopup(
      "Insufficient Balance",
      `You don't have enough ${isCash ? "cash" : "online"} balance.`,
      "error"
    );
    return;
  }

  if (!day.cashMovements) day.cashMovements = [];

  day.cashMovements.push({
    id: Date.now(),
    time: new Date().toLocaleTimeString("en-IN"),
    account,
    type,
    amount,
    note
  });

  document.getElementById(
    isCash ? "cashMovementAmount" : "onlineMovementAmount"
  ).value = "";

  document.getElementById(
    isCash ? "cashMovementNote" : "onlineMovementNote"
  ).value = "";

  persist();
  refreshDashboard();

  showCustomPopup(
    "Saved!",
    `${isCash ? "Cash" : "Online"} entry recorded successfully.`,
    "success"
  );
}

/* ==================================
   REGULAR TRANSACTIONS
================================== */

function addBusinessTransaction() {
  const day = currentDay();

  if (!day || day.closed) {
    showCustomPopup(
      "Business Day Not Started",
      "Please start a business day first.",
      "error"
    );
    return;
  }

  const type = document.getElementById("transactionType").value;
  const amount =
    Number(document.getElementById("transactionAmount").value);

  if (!Number.isFinite(amount) || amount <= 0) {
    showCustomPopup(
      "Invalid Amount",
      "Please enter a valid transaction amount.",
      "error"
    );
    return;
  }

  const charge = ["AEPS", "C+", "C-"].includes(type)
    ? chargeFor(amount)
    : 0;
   
  const chargePaymentMethod =
    document.getElementById("chargePaymentMethod").value;

  const platform = type === "AEPS"
    ? document.getElementById("platform").value
    : "";

   const transaction = {
    id: Date.now(),
    time: new Date().toLocaleTimeString("en-IN"),
    type,
    amount,
    charge,
    chargePaymentMethod,
    platform
  };

  const totals = calculateTotals(day);

  if (type === "C+" && amount > totals.online) {
    showCustomPopup(
      "Insufficient Balance",
      "You don't have enough online balance.",
      "error"
    );
    return;
  }

  if (
    type === "C-" &&
    amount - (chargePaymentMethod === "CASH" ? charge : 0) > totals.cash
 ) {
    showCustomPopup(
      "Insufficient Balance",
      "You don't have enough cash for this transaction.",
      "error"
    );
    return;
  }

  if (type === "AEPS" && amount > totals.cash) {
    showCustomPopup(
      "Insufficient Balance",
      "You don't have enough cash for this AEPS transaction.",
      "error"
    );
    return;
  }

  day.transactions.push(transaction);
  persist();

  document.getElementById("transactionAmount").value = "";
  document.getElementById("customerCharge").value = "";
  document.getElementById("chargePaymentMethod").value = "CASH";

  calculateChargePreview();
  refreshDashboard();

  showCustomPopup(
    "Transaction Successful!",
    "Your transaction has been saved successfully.",
    "success",
    `<div style="padding:12px;background:#f1f6fc;border-radius:10px;">
      <strong>Amount:</strong> ${money(amount)}
      <br>
      <strong>Customer Charge:</strong> ${money(charge)}
    </div>`
  );
}

function addOnlineWithdrawal() {
  const day = currentDay();

  if (!day || day.closed) {
    alert("Start a business day first.");
    return;
  }

  const platform =
    document.getElementById("withdrawalPlatform").value;

  const amount =
    Number(document.getElementById("withdrawalAmount").value);

  const note =
    document.getElementById("withdrawalNote").value.trim();

  if (!Number.isFinite(amount) || amount <= 0) {
    alert("Enter a valid withdrawal amount.");
    return;
  }

  const totals = calculateTotals(day);

  const walletBalances = {
    Biznext: totals.biznext,
    Roinet: totals.roinet,
    Tez: totals.tez,
    Fino: totals.fino,
    SBI: totals.sbi
  };

  if (amount > walletBalances[platform]) {
    alert("Insufficient " + platform + " wallet balance.");
    return;
  }

  day.transactions.push({
    id: Date.now(),
    time: new Date().toLocaleTimeString("en-IN"),
    type: "ONLINE_WITHDRAWAL",
    platform,
    amount,
    note
  });

  persist();

  document.getElementById("withdrawalAmount").value = "";
  document.getElementById("withdrawalNote").value = "";

  refreshDashboard();

  showCustomPopup(
    "Withdrawal Successful!",
    "Your online balance withdrawal has been saved.",
    "success",
    `<div style="padding:12px;background:#f1f6fc;border-radius:10px;">
      <strong>Software:</strong> ${platform}
      <br>
      <strong>Amount:</strong> ${money(amount)}
    </div>`
  );
}

/* ==================================
   DASHBOARD
================================== */
function drawBusinessPerformanceChart() {
  const canvas = document.getElementById("businessPerformanceChart");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");

  const chartStyles = getComputedStyle(document.documentElement);
  const gridColor = chartStyles.getPropertyValue("--line").trim();
  const mutedColor = chartStyles.getPropertyValue("--muted").trim();

  const width = canvas.clientWidth;
  const height = 260;
  const ratio = window.devicePixelRatio || 1;

  canvas.width = width * ratio;
  canvas.height = height * ratio;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

  const days = [];

  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);

    const key = date.getFullYear() + "-" +
      String(date.getMonth() + 1).padStart(2, "0") + "-" +
      String(date.getDate()).padStart(2, "0");

    
const savedDay = data.days.find(d => d.date === key);

const chartDay = {
  date: key,
  sessions: savedDay ? [...getDaySessions(savedDay)] : []
};

if (data.currentDay?.date === key) {
  chartDay.sessions.push(data.currentDay);
}

const totals = chartDay.sessions.length
  ? calculateDailyTotals(chartDay)
  : null;
    

    days.push({
      label: date.toLocaleDateString("en-IN", {
  day: "2-digit",
  month: "short"
}),
      business: totals ? totals.business : 0,
      profit: totals ? totals.profit : 0
    });
  }

  const max = Math.max(1, ...days.map(d =>
    Math.max(d.business, d.profit)
  ));

  const left = 48;
  const right = width - 12;
  const top = 20;
  const bottom = height - 35;

  ctx.clearRect(0, 0, width, height);

  ctx.font = "11px Arial";
  ctx.textAlign = "right";
  ctx.fillStyle = mutedColor;

  for (let i = 0; i <= 4; i++) {
    const y = bottom - (bottom - top) * i / 4;
    ctx.fillText(Math.round(max * i / 4).toLocaleString("en-IN"), left - 8, y + 4);
    ctx.beginPath();
    ctx.strokeStyle = gridColor;
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.stroke();
  }

 function drawLine(key, color) {
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;

  days.forEach((d, i) => {
    const x = left + (right - left) * i / 6;
    const y = bottom - (d[key] / max) * (bottom - top);

    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });

  ctx.stroke();

  days.forEach((d, i) => {
    if (d[key] <= 0) return;

    const x = left + (right - left) * i / 6;
    const y = bottom - (d[key] / max) * (bottom - top);

    ctx.beginPath();
    ctx.fillStyle = color;
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = "11px Arial";
    ctx.textAlign = "center";
    ctx.fillStyle = color;

    const amount = new Intl.NumberFormat("en-IN", {
      notation: "compact",
      maximumFractionDigits: 1
    }).format(d[key]);

    ctx.fillText(
      "₹" + amount,
      x,
      y + (key === "business" ? -10 : 15)
    );
  });
}

  drawLine("business", "#2563eb");
  drawLine("profit", "#16a34a");

  ctx.textAlign = "center";
  ctx.fillStyle = mutedColor;

  days.forEach((d, i) => {
    const x = left + (right - left) * i / 6;
    ctx.fillText(d.label, x, height - 12);
  });
}

function deleteBusinessEntry(entryId, type) {
  const day = currentDay();

  if (!day || day.closed) {
    showCustomPopup("Cannot Delete", "Only entries in an open Business Shift can be deleted.", "error");
    return;
  }

  const list = type === "expense"
    ? day.expenses
    : type === "movement"
      ? day.cashMovements
      : day.transactions;

  const index = (list || []).findIndex(
    entry => String(entry.id) === String(entryId)
  );

  if (index === -1) return;

  showCustomConfirm(
    "Delete Entry?",
    "This entry will be removed from business totals and saved in Deleted Entries History.",
    () => {
      const entry = list[index];
      moveToDeletedHistory(entry, type, "Business Shift");
      list.splice(index, 1);
      persist();

     if (type === "expense") renderExpenseList();
     if (type === "movement") renderCashMovements();

      const historyTitle = document.getElementById("dashboardHistoryTitle")?.textContent || "";

     if (historyTitle === "Today's Transactions") {
       openTodayTransactions();
    } else if (historyTitle === "Today's Services") {
     openTodayServices();
   } else if (historyTitle === "Today's Withdrawals") {
    openTodayWithdrawals();
  }

refreshDashboard();
      showCustomPopup("Deleted", "Entry moved to Deleted Entries History.", "success");
    }
  );
}

function showDashboardHistory(title, items, type) {
  const popup = document.getElementById("dashboardHistoryPopup");
  const content = document.getElementById("dashboardHistoryContent");
  const summary = document.getElementById("dashboardHistorySummary");

  document.getElementById("dashboardHistoryTitle").textContent = title;

  if (!items.length) {
    summary.textContent = "0 records found today.";
    content.innerHTML = "<p>No records available yet.</p>";
  } else {
    summary.textContent = items.length + " records found today.";

    content.innerHTML = items.slice().reverse().map(t => {
      let heading = t.type === "ONLINE_WITHDRAWAL"
        ? (t.platform + " Withdrawal")
        : t.type === "SERVICE"
          ? escapeLedgerHTML(t.serviceName || "")
          : t.type + (t.platform ? " · " + t.platform : "");

      let details = "";

      if (type === "transactions") {
        details = `
          <p>Amount: ${money(t.amount)}</p>
          <p>Customer Charge: ${money(t.charge || 0)}</p>
          ${t.type === "SERVICE"
            ? `<p>Payment: ${t.paymentMethod || ""}</p>`
            : `<p>Charge Payment: ${t.chargePaymentMethod || "N/A"}</p>`}
        `;
      } else if (type === "services") {
        details = `
          <p>Amount: ${money(t.amount)}</p>
          <p>Quantity: ${t.quantity || "Direct entry"}</p>
          <p>Payment: ${t.paymentMethod || ""}</p>
          <p>Cash: ${money(t.cashAmount || 0)} | Online: ${money(t.onlineAmount || 0)}</p>
        `;
      } else {
        details = `
          <p>Amount: ${money(t.amount)}</p>
          <p>Customer Charge: ${money(t.charge || 0)}</p>
          <p>Charge Payment: ${t.chargePaymentMethod || "N/A"}</p>
        `;
      }

      return `
        <div style="padding:12px 0;border-bottom:1px solid var(--line);text-align:left;">
          <strong>${heading}</strong>
          <p>${t.time || ""}</p>
          ${details}
          ${!currentDay()?.closed ? `<button onclick="deleteBusinessEntry('${t.id}', 'transaction')">Delete</button>` : ""}
        </div>
      `;
    }).join("");
  }

  popup.style.display = "flex";
}

function openTodayTransactions() {
  const day = currentDay();
  const items = day
    ? (day.transactions || []).filter(t => t.type !== "SERVICE")
    : [];

  showDashboardHistory("Today's Transactions", items, "transactions");
}

function openTodayServices() {
  const day = currentDay();
  const items = day
    ? (day.transactions || []).filter(t => t.type === "SERVICE")
    : [];

  showDashboardHistory("Today's Services", items, "services");
}

function openTodayWithdrawals() {
  const day = currentDay();
  const items = day
    ? (day.transactions || []).filter(t =>
        ["AEPS", "ONLINE_WITHDRAWAL"].includes(t.type)
      )
    : [];

  showDashboardHistory("Today's Withdrawals", items, "withdrawals");
}

function closeDashboardHistory() {
  document.getElementById("dashboardHistoryPopup").style.display = "none";
}

function refreshDashboard() {
  const day = currentDay();
renderExpenseList();

const todayReportDay = getReportDays(today(), today())[0] || {
  date: today(),
  sessions: day ? getDaySessions(day) : []
};

const todaySessions = todayReportDay.sessions || [];
const allTodayTransactions = todaySessions.flatMap(s => s.transactions || []);
const allTodayWithdrawals = allTodayTransactions.filter(t =>
  ["AEPS", "ONLINE_WITHDRAWAL"].includes(t.type)
);

  const todayTransactions = allTodayTransactions.filter(
  t => t.type !== "SERVICE"
);

const todayServices = allTodayTransactions.filter(
  t => t.type === "SERVICE"
);

const todayWithdrawals = allTodayWithdrawals;

  document.getElementById("todayTransactionCount").textContent =
    todayTransactions.length;

  document.getElementById("todayServiceCount").textContent =
    todayServices.length;

  document.getElementById("todayWithdrawalAmount").textContent =
    money(todayWithdrawals.reduce(
      (sum, t) => sum + (Number(t.amount) || 0), 0
    ));

  document.getElementById("todayDate").textContent =
    new Date().toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric"
    });

  drawBusinessPerformanceChart();
  
  const walletIds = [
    "biznextBalance", "roinetBalance", "tezBalance", "finoBalance",
    "sbiBalance", "combinedCollection",
    "biznextCollection", "roinetCollection", "tezCollection",
    "finoCollection", "sbiCollection",
    "cashBalance", "onlineBalance",
    "totalBusiness", "netProfit",
    "cashNetProfit", "onlineNetProfit"
  ];

  if (!day) {
    walletIds.forEach(id => {
      document.getElementById(id).textContent = money(0);
    });

    document.getElementById("openingSection").style.display = "block";
    syncOpeningWalletFields();

    document.getElementById("transactionList").innerHTML =
      "<p>No active business day. Enter opening balances to begin.</p>";

    document.getElementById("withdrawalList").innerHTML =
      "<p>No withdrawals recorded yet.</p>";
    return;
  }

  const t = calculateTotals(day);
const dailyTotals = calculateDailyTotals(todayReportDay);

  document.getElementById("biznextBalance").textContent = money(dailyTotals.biznext);
  document.getElementById("roinetBalance").textContent = money(dailyTotals.roinet);
  document.getElementById("tezBalance").textContent = money(dailyTotals.tez);
  document.getElementById("finoBalance").textContent = money(dailyTotals.fino);
  document.getElementById("sbiBalance").textContent = money(dailyTotals.sbi);
  
  const walletNetMovement = platform =>
  allTodayTransactions.reduce((sum, transaction) => {
    if (transaction.platform !== platform) return sum;

    const amount = Number(transaction.amount) || 0;

    if (transaction.type === "AEPS") return sum + amount;
    if (transaction.type === "ONLINE_WITHDRAWAL") return sum - amount;

    return sum;
  }, 0);

document.getElementById("biznextCollection").textContent =
  money(walletNetMovement("Biznext"));

document.getElementById("roinetCollection").textContent =
  money(walletNetMovement("Roinet"));

document.getElementById("tezCollection").textContent =
  money(walletNetMovement("Tez"));

document.getElementById("finoCollection").textContent =
  money(walletNetMovement("Fino"));

document.getElementById("sbiCollection").textContent =
  money(walletNetMovement("SBI"));

const combinedBiznextRoinet = allTodayTransactions
  .filter(transaction =>
    transaction.type === "AEPS" &&
    ["Biznext", "Roinet"].includes(transaction.platform)
  )
  .reduce((sum, transaction) =>
    sum + (Number(transaction.amount) || 0), 0
  );

document.getElementById("combinedCollection").textContent =
  money(combinedBiznextRoinet);

  document.getElementById("cashBalance").textContent = money(dailyTotals.cash);
  document.getElementById("onlineBalance").textContent = money(dailyTotals.online);
  document.getElementById("cashNetProfit").textContent = money(dailyTotals.cashNetProfit);
  document.getElementById("onlineNetProfit").textContent = money(dailyTotals.onlineNetProfit);
  document.getElementById("netProfit").textContent = money(dailyTotals.netProfit);

  document.getElementById("openingSection").style.display = "none";

  const withdrawalList = document.getElementById("withdrawalList");

  const withdrawals = day.transactions.filter(
    t => t.type === "ONLINE_WITHDRAWAL"
  );

  if (withdrawals.length === 0) {
    withdrawalList.innerHTML = "<p>No withdrawals recorded yet.</p>";
  } else {
    withdrawalList.innerHTML = withdrawals.map(t => `
      <div style="padding:12px 0;border-bottom:1px solid #e2eaf2">
        <strong>${t.platform} Withdrawal</strong>
        <p>${t.time}</p>
        <p>Amount: ${money(t.amount)}</p>
        <p>Note: ${t.note || "No note"}</p>
      </div>
    `).join("");
  }

    // Today's normal business transactions
  const list = document.getElementById("transactionList");
  const normalTransactions = day.transactions.filter(
    t => t.type !== "SERVICE" && t.type !== "ONLINE_WITHDRAWAL"
  );

  if (list) {
    list.innerHTML = normalTransactions.length
      ? normalTransactions.map(t => `
          <div style="padding:12px 0;border-bottom:1px solid #e2eaf2">
            <strong>${t.type} ${t.platform ? "· " + t.platform : ""}</strong>
            <p>${t.time}</p>
            <p>Amount: ${money(t.amount)}</p>
            <p>Customer charge: ${money(t.charge)}</p>
          </div>
        `).join("")
      : "<p>No transactions recorded yet.</p>";
  }

  // Today's services
  const serviceList = document.getElementById("serviceList");
  const services = day.transactions.filter(t => t.type === "SERVICE");

  if (serviceList) {
    serviceList.innerHTML = services.length
      ? services.map(t => `
          <div style="padding:12px 0;border-bottom:1px solid #e2eaf2">
            <strong>${escapeLedgerHTML(t.serviceName || "")}</strong>
            <p>${t.time}</p>
            <p>${t.quantity ? "Quantity: " + t.quantity : "Direct amount entry"}</p>
            <p>Amount: ${money(t.amount)}</p>
            <p>Payment: ${t.paymentMethod}</p>
            <p>Cash: ${money(t.cashAmount)} | Online: ${money(t.onlineAmount)}</p>
          </div>
        `).join("")
      : "<p>No services recorded yet.</p>";
  }

  renderCashMovements();
}

function renderCashMovements() {
  const day = currentDay();
  const list = document.getElementById("cashMovementList");

  if (!list) return;

  const entries = day ? (day.cashMovements || []) : [];

  if (entries.length === 0) {
    list.innerHTML = "<p>No cash entries yet.</p>";
    return;
  }

list.innerHTML = entries.slice().reverse().map(entry => {
  const account = entry.account || "CASH";

  const label = account === "ONLINE"
    ? (entry.type === "IN" ? "Online Money In" : "Online Money Out")
    : (entry.type === "IN" ? "Cash In" : "Cash Out");

  return `
    <div style="padding:12px 0;border-bottom:1px solid #e2eaf2">
      <strong>${label}</strong>
      <p>${entry.time}</p>
      <p>Amount: ${money(entry.amount)}</p>
      <p>Note: ${entry.note || "No note"}</p>
      <button onclick="deleteBusinessEntry('${entry.id}', 'movement')">Delete</button>
    </div>
  `;
}).join("");
}

function saveExpense() {
  const day = currentDay();

  if (!day || day.closed) {
    showCustomPopup("Shop Closed", "Start a business day first.", "error");
    return;
  }

  const category = document.getElementById("expenseCategory").value;
  const paymentMethod = document.getElementById("expensePaymentMethod").value;
  const amount = Number(document.getElementById("expenseAmount").value);
  const note = document.getElementById("expenseNote").value.trim();

  if (!Number.isFinite(amount) || amount <= 0) {
    showCustomPopup("Invalid Amount", "Enter a valid expense amount.", "error");
    return;
  }

 const currentTotals = calculateTotals(day);
const availableBalance = paymentMethod === "ONLINE"
  ? currentTotals.online
  : currentTotals.cash;

if (amount > availableBalance) {
  showCustomPopup(
    "Insufficient Balance",
    `Available ${paymentMethod === "ONLINE" ? "Online" : "Cash"} balance: ${money(availableBalance)}`,
    "error"
  );
  return;
 }
  
  if (!day.expenses) day.expenses = [];

  day.expenses.push({
    id: Date.now(),
    time: new Date().toLocaleTimeString("en-IN"),
    category,
    paymentMethod,
    amount,
    note
  });

  document.getElementById("expenseAmount").value = "";
  document.getElementById("expenseNote").value = "";

  persist();
  renderExpenseList();
  refreshDashboard();

  showCustomPopup("Saved!", "Expense recorded successfully.", "success");
}

function renderExpenseList() {
  const day = currentDay();
  const list = document.getElementById("expenseList");

  if (!list) return;

  const expenses = day ? (day.expenses || []) : [];

  if (expenses.length === 0) {
    list.innerHTML = "<p>No expenses yet.</p>";
    return;
  }

  list.innerHTML = expenses.slice().reverse().map(expense => `
    <div style="padding:12px 0;border-bottom:1px solid #e2eaf2">
      <strong>${expense.category}</strong>
      <p>${expense.time}</p>
      <p>Amount: ${money(expense.amount)}</p>
      <p>Paid By: ${expense.paymentMethod === "CASH" ? "Cash" : expense.paymentMethod === "ONLINE" ? "Online" : "Not recorded"}</p>
      <p>Note: ${expense.note || "No note"}</p>
      <button onclick="deleteBusinessEntry('${expense.id}', 'expense')">Delete</button>
    </div>
  `).join("");
}

/* ==================================
   DAILY CLOSING
================================== */
function previewClosing() {
  const day = currentDay();

  if (!day) {
    showCustomPopup("Shop Closed", "Start a business day first.", "error");
    return;
  }

  const cashInput = document.getElementById("actualCash").value.trim();
  const onlineInput = document.getElementById("actualOnline").value.trim();

  if (cashInput === "" || onlineInput === "") {
    showCustomPopup(
      "Balance Required",
      "Please enter both Actual Cash and Actual Online balances to check the differences.",
      "error"
    );
    return;
  }

  const actualCash = Number(cashInput);
  const actualOnline = Number(onlineInput);

  if (
    !Number.isFinite(actualCash) || actualCash < 0 ||
    !Number.isFinite(actualOnline) || actualOnline < 0
  ) {
    showCustomPopup("Invalid Balance", "Please enter valid actual balances.", "error");
    return;
  }

  const totals = calculateTotals(day);

  const getDifference = (actual, expected) => {
  const difference = actual - expected;

  if (difference === 0) {
    return '<strong class="closing-matched">MATCHED</strong>';
  }

  if (difference > 0) {
    return `<strong class="closing-excess">EXCESS: ${money(difference)}</strong>`;
  }

  return `<strong class="closing-shortage">SHORTAGE: ${money(Math.abs(difference))}</strong>`;
};

  document.getElementById("closingResult").innerHTML = `
    <h4>Cash Closing</h4>
    <p><strong>Expected Cash:</strong> ${money(totals.cash)}</p>
    <p><strong>Actual Cash:</strong> ${money(actualCash)}</p>
    <p>${getDifference(actualCash, totals.cash)}</p>

    <hr>

    <h4>Online Closing</h4>
    <p><strong>Expected Online:</strong> ${money(totals.online)}</p>
    <p><strong>Actual Online:</strong> ${money(actualOnline)}</p>
    <p>${getDifference(actualOnline, totals.online)}</p>
  `;
}

function saveBusinessDay() {
  const day = currentDay();

  if (!day) {
    alert("Start a business day first.");
    return;
  }

 const cashInput = document.getElementById("actualCash").value.trim();
const onlineInput = document.getElementById("actualOnline").value.trim();

if (cashInput === "" || onlineInput === "") {
  showCustomPopup(
    "Balance Required",
    "Please enter both Actual Cash and Actual Online balances before saving the day.",
    "error"
  );
  return;
}

const actual = Number(cashInput);
const actualOnline = Number(onlineInput);

if (!Number.isFinite(actual) || actual < 0) {
  showCustomPopup("Invalid Cash Balance", "Please enter a valid actual cash balance.", "error");
  return;
}

if (!Number.isFinite(actualOnline) || actualOnline < 0) {
  showCustomPopup("Invalid Online Balance", "Please enter a valid actual online balance.", "error");
  return;
}

showCustomConfirm(
  "Close Business Day?",
  "Save and close this business day? This cannot be edited from the dashboard.",
  () => {
    
  const totals = calculateTotals(day);

  day.closing = {
    ...totals,
    actualCash: actual,
    actualOnline: actualOnline,
    difference: actual - totals.cash,
    onlineDifference: actualOnline - totals.online,
    closedAt: new Date().toISOString()
  };

  day.closed = true;

  data.walletCarryForward = {
    biznext: totals.biznext,
    roinet: totals.roinet,
    tez: totals.tez,
    fino: totals.fino,
    sbi: totals.sbi
  };

const existingIndex = data.days.findIndex(
  savedDay => savedDay.date === day.date
);

// Preserve this session separately.
if (existingIndex === -1) {
  data.days.push({
    date: day.date,
    sessions: [day]
  });
} else {
  const existingRecord = data.days[existingIndex];
  const previousSessions = getDaySessions(existingRecord);

  data.days[existingIndex] = {
    date: day.date,
    sessions: [...previousSessions, day]
  };
}

// Carry forward wallets from the session just closed.
const sessionTotals = calculateTotals(day);

data.walletCarryForward = {
  biznext: sessionTotals.biznext,
  roinet: sessionTotals.roinet,
  tez: sessionTotals.tez,
  fino: sessionTotals.fino,
  sbi: sessionTotals.sbi
};

  data.currentDay = null;

  persist();

  document.getElementById("openingSection").style.display = "block";
  document.getElementById("closingResult").innerHTML = "";
  document.getElementById("actualCash").value = "";
  document.getElementById("actualOnline").value = "";

refreshDashboard();
openAppScreen("opening");

alert("Business day saved! The shop is now closed.");
  }
);
}

/* ==================================
   HISTORY AND BACKUP
================================== */

function showHistory() {
  renderTodayCompleteHistory();

  const history = document.getElementById("todayCompleteHistoryList");
  if (history) {
    history.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }
}

function renderTodayCompleteHistory() {
  const container = document.getElementById("todayCompleteHistoryList");
  if (!container) return;

  const todayDate = today();
  const records = [];

  const addRecord = (category, title, date, time, amount, note = "", shift = "") => {
    records.push({
      category,
      title,
      date: date || todayDate,
      time: time || "",
      amount: Number(amount) || 0,
      note: note || "",
      shift
    });
  };

  const sessions = [];

  (data.days || []).forEach(day => {
    if (day.date === todayDate) {
      getDaySessions(day).forEach(session => sessions.push(session));
    }
  });

  if (data.currentDay && data.currentDay.date === todayDate) {
    sessions.push(data.currentDay);
  }

  sessions.forEach((session, index) => {
    const shiftNumber = session.sessionNumber || index + 1;
    const shift = "Business Shift " + shiftNumber;

    (session.transactions || []).forEach(t => {
      addRecord(
        t.type === "SERVICE" ? "Services" : "Transactions",
        t.serviceName || t.type + (t.platform ? " · " + t.platform : ""),
        todayDate,
        t.time,
        t.amount,
        "Charge: " + money(t.charge || 0),
        shift
      );
    });

    (session.expenses || []).forEach(e => {
      addRecord(
        "Expenses",
        e.category,
        todayDate,
        e.time,
        e.amount,
        e.paymentMethod + (e.note ? " · " + e.note : ""),
        shift
      );
    });

    (session.cashMovements || []).forEach(m => {
      addRecord(
        "Cash / Online Movements",
        (m.account || "CASH") + " " + m.type,
        todayDate,
        m.time,
        m.amount,
        m.note,
        shift
      );
    });
  });

  (data.customers || []).forEach(customer => {
    (customer.history || []).forEach(entry => {
      if (entry.date === todayDate) {
        addRecord(
          "Customer Ledger",
          (entry.label || entry.type) + " · " + customer.name,
          entry.date,
          entry.time,
          entry.amount,
          entry.note,
          entry.sessionNumber
            ? "Business Shift " + entry.sessionNumber
            : "Other Records"
        );
      }
    });
  });

  (data.deletedEntries || []).forEach(entry => {
    const deletionDate = entry.deletedTimestamp
      ? entry.deletedTimestamp.slice(0, 10)
      : "";

    if (deletionDate === todayDate || entry.originalDate === todayDate) {
      addRecord(
        "Deleted Entries",
        (entry.deletedType || "Entry") + " · " +
          (entry.serviceName || entry.category || entry.type || ""),
        todayDate,
        entry.deletedAt,
        entry.amount,
        "Deleted record · " + (entry.note || entry.deletedFrom || ""),
        entry.sessionNumber
          ? "Business Shift " + entry.sessionNumber
          : "Other Records"
      );
    }
  });

  const safe = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;", "'": "&#39;"
  })[char]);

  const groupedRecords = {};

  records.forEach(record => {
    const group = record.shift || "Other Records";

    if (!groupedRecords[group]) {
      groupedRecords[group] = [];
    }

    groupedRecords[group].push(record);
  });

  const shiftGroups = Object.keys(groupedRecords).sort((a, b) => {
    if (a === "Other Records") return 1;
    if (b === "Other Records") return -1;

    const numA = Number(a.match(/\d+/)?.[0] || 0);
    const numB = Number(b.match(/\d+/)?.[0] || 0);

    return numA - numB;
  });

  shiftGroups.forEach(group => {
    groupedRecords[group].sort((a, b) =>
      b.time.localeCompare(a.time)
    );
  });

  container.innerHTML = `
    <h3>Today's Complete History</h3>
    <p>${todayDate} · ${records.length} records</p>

    <div style="max-height:650px;overflow-y:auto;padding:10px;border:1px solid var(--line);border-radius:10px;">

      ${shiftGroups.length ? shiftGroups.map(group => `
        <div style="margin-bottom:18px;">
          <h3 style="padding:12px;background:var(--light-blue);border-radius:8px;color:var(--text);">
            ${safe(group)}
            <small style="font-weight:normal;">
              (${groupedRecords[group].length} records)
            </small>
          </h3>

          ${groupedRecords[group].map(record => `
            <div style="padding:12px 4px;border-bottom:1px solid var(--line);">
              <small>${safe(record.category)}</small>
              <strong style="display:block;">${safe(record.title)}</strong>
              <p>${safe(record.time)}</p>
              <strong>${money(record.amount)}</strong>
              ${record.note ? `<p>${safe(record.note)}</p>` : ""}
            </div>
          `).join("")}
        </div>
      `).join("") : "<p>No records found for today.</p>"}

    </div>
  `;
}

function changeCalendarMonth(offset) {
  calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + offset, 1);
  renderCalendar();
}

function selectHistoryDate(date) {
  selectedHistoryDate = date;
  renderCalendar();
}

function renderCalendar() {
  const history = document.getElementById("calendarHistoryList");
  if (!history) return;

  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();

  const monthLabel = calendarMonth.toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric"
  });

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const savedDates = new Set((data.days || []).map(day => day.date));

  if (data.currentDay) {
    savedDates.add(data.currentDay.date);
  }

  const cells = [];

  for (let i = 0; i < firstDay; i++) {
    cells.push('<span class="calendar-empty"></span>');
  }

  for (let dayNumber = 1; dayNumber <= daysInMonth; dayNumber++) {
    const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(dayNumber).padStart(2, "0")}`;
    const hasRecord = savedDates.has(date);
    const selected = date === selectedHistoryDate ? " selected" : "";

    cells.push(`<button type="button" class="calendar-day${hasRecord ? " has-record" : ""}${selected}" onclick="selectHistoryDate('${date}')">${dayNumber}</button>`);
  }

  const savedRecord = (data.days || []).find(
    day => day.date === selectedHistoryDate
  );

  const selectedSessions = savedRecord
    ? [...getDaySessions(savedRecord)]
    : [];

  if (data.currentDay && data.currentDay.date === selectedHistoryDate) {
    selectedSessions.push(data.currentDay);
  }

  let detail = '<p class="muted">No business record for this date.</p>';

  if (selectedSessions.length) {
    const dailyTotals = calculateDailyTotals({
      date: selectedHistoryDate,
      sessions: selectedSessions
    });

    const title = selectedSessions.length === 1
      ? "Shop Opening"
      : `Shop Opening • ${selectedSessions.length} Business Shifts`;

    const sessionDetails = selectedSessions.map((session, index) => {
      const totals = calculateTotals(session);

      const status = session.closed
        ? '<span class="record-tag">Closed</span>'
        : '<span class="record-tag active-tag">In progress</span>';

      return `
        <details class="history-transaction">
          <summary>
            <h4 style="display:inline;">Business Shift ${index + 1} ${status}</h4>
          </summary>
          <div>
            <p><strong>Opening Cash:</strong> ${money(session.opening?.cash || 0)}</p>
            <p><strong>Opening Online:</strong> ${money(session.opening?.online || 0)}</p>
            <p><strong>Business:</strong> ${money(totals.business)}</p>
            <p><strong>Profit:</strong> ${money(totals.profit)}</p>
            <p><strong>Cash difference:</strong>
              ${session.closing ? money(session.closing.difference) : "Not closed"}
            </p>
            <p><strong>Online difference:</strong>
              ${session.closing ? money(session.closing.onlineDifference || 0) : "Not closed"}
            </p>
          </div>
        </details>
      `;
    }).join("");

    detail = `
      <details class="history-day" open>
        <summary class="history-day-summary">
          <span class="history-day-number">1</span>
          <span class="history-day-main">
            <strong>${title}</strong>
            <span class="history-day-amounts">
              ${money(dailyTotals.business)} Business
              <span>•</span>
              ${money(dailyTotals.profit)} Profit
            </span>
          </span>
          <span class="history-day-arrow">⌄</span>
        </summary>

        <div class="history-day-details">
          <p><strong>Date:</strong> ${selectedHistoryDate}</p>
          ${sessionDetails}
        </div>
      </details>
    `;
  }

  history.innerHTML = `
    <div class="calendar-header">
      <button type="button" class="calendar-nav" onclick="changeCalendarMonth(-1)" aria-label="Previous month">‹</button>
      <strong>${monthLabel}</strong>
      <button type="button" class="calendar-nav" onclick="changeCalendarMonth(1)" aria-label="Next month">›</button>
    </div>

    <div class="calendar-grid calendar-weekdays">
      ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(x => `<span>${x}</span>`).join("")}
    </div>

    <div class="calendar-grid">${cells.join("")}</div>

    <p class="calendar-legend">
      <span></span> Dates with saved business records
    </p>

    <div class="history-day-list">${detail}</div>
  `;
}

function exportData() {
  const blob = new Blob(
    [JSON.stringify(data, null, 2)],
    { type: "application/json" }
  );

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = "Aditya-Multi-Services-Backup.json";
  link.click();

  URL.revokeObjectURL(url);
}

/* ==================================
   CUSTOMER LEDGER
================================== */

let activeCustomerId = null;
let customerPaymentMode = null;

function escapeLedgerHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function getCustomer(id) {
  return data.customers.find(customer => customer.id === id);
}

function customerBalance(customer) {
  return Math.max(0, Number(customer.totalDue || 0) - Number(customer.received || 0));
}

function shopOwesBalance(customer) {
  return Math.max(0, Number(customer.totalShopOwes || 0) - Number(customer.given || 0));
}

function initializeCustomerLedger() {
  data.customers.forEach(customer => {
    if (!Array.isArray(customer.history)) customer.history = [];
    if (!Number.isFinite(Number(customer.totalDue))) customer.totalDue = 0;
    if (!Number.isFinite(Number(customer.received))) customer.received = 0;
    if (!Number.isFinite(Number(customer.totalShopOwes))) customer.totalShopOwes = 0;
    if (!Number.isFinite(Number(customer.given))) customer.given = 0;
  });

  const account = document.getElementById("customerAccountSection");

  if (account && !document.getElementById("addCustomerDueButton")) {
    const firstButton = account.querySelector('button[onclick*="showCustomerPaymentForm"]');

    if (firstButton) {
      firstButton.insertAdjacentHTML("beforebegin", `
        <button type="button" id="addCustomerDueButton"
          onclick="showCustomerPaymentForm('addDue')">
          ADD AMOUNT DUE
        </button>

        <button type="button" id="addShopOwesButton"
          onclick="showCustomerPaymentForm('addOwe')">
          ADD AMOUNT WE OWE
        </button>
      `);
    }
  }

  const search = document.getElementById("customerSearch");

  if (search && !search.dataset.ledgerReady) {
    search.addEventListener("input", renderCustomerLedger);
    search.dataset.ledgerReady = "true";
  }

  renderCustomerLedger();
}

function showAddCustomerForm() {
  document.getElementById("customerFormSection").style.display = "block";
  document.getElementById("customerName").focus();
}

function hideAddCustomerForm() {
  document.getElementById("customerFormSection").style.display = "none";
  document.getElementById("customerName").value = "";
  document.getElementById("customerMobile").value = "";
}

function addLedgerCustomer() {
  const name = document.getElementById("customerName").value.trim();
  const mobile = document.getElementById("customerMobile").value.trim();

  if (!name) {
    showCustomPopup("Customer Name Required", "Please enter the customer's name.", "error");
    return;
  }

  const duplicate = data.customers.some(customer =>
    mobile && customer.mobile && customer.mobile === mobile
  );

  if (duplicate) {
    showCustomPopup("Customer Already Exists", "A customer with this mobile number already exists.", "error");
    return;
  }

  const customer = {
    id: "customer_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
    name,
    mobile,
    totalDue: 0,
    received: 0,
    totalShopOwes: 0,
    given: 0,
    history: [],
    createdAt: new Date().toISOString()
  };

  data.customers.push(customer);

  persist();
  hideAddCustomerForm();
  renderCustomerLedger();

  showCustomPopup("Customer Added", name + " has been added successfully.", "success");
}

function renderCustomerLedger() {
  const list = document.getElementById("customerList");
  const owesTotal = document.getElementById("customerOwesTotal");
  const shopOwesTotal = document.getElementById("shopOwesTotal");
  const report = document.getElementById("customerOutstandingReport");

  if (!list || !owesTotal || !shopOwesTotal || !report) return;

  const customers = data.customers || [];

  const totalCustomerOwes = customers.reduce(
    (sum, customer) => sum + customerBalance(customer), 0
  );

  const totalShopOwes = customers.reduce(
    (sum, customer) => sum + shopOwesBalance(customer), 0
  );

  owesTotal.textContent = money(totalCustomerOwes);
  shopOwesTotal.textContent = money(totalShopOwes);

  const search = (document.getElementById("customerSearch")?.value || "")
    .trim().toLowerCase();

  const filtered = customers.filter(customer =>
    customer.name.toLowerCase().includes(search) ||
    String(customer.mobile || "").toLowerCase().includes(search)
  );

  if (!filtered.length) {
    list.innerHTML = customers.length
      ? "<p>No matching customers found.</p>"
      : "<p>No customers added yet.</p>";
  } else {
    list.innerHTML = filtered.map(customer => {
      const due = customerBalance(customer);
      const payable = shopOwesBalance(customer);

      return `
        <div class="customer-ledger-card"
          style="padding:15px 0;border-bottom:1px solid var(--line);">

          <strong>${escapeLedgerHTML(customer.name)}</strong>
          <p>${escapeLedgerHTML(customer.mobile || "No mobile number")}</p>

          <p>Remaining customer due:
            <strong>${money(due)}</strong>
          </p>

          <p>Remaining amount we owe:
            <strong>${money(payable)}</strong>
          </p>

          <button type="button"
            onclick="openCustomerAccount('${escapeLedgerHTML(customer.id)}')">
            VIEW ACCOUNT &amp; HISTORY
          </button>
        </div>
      `;
    }).join("");
  }

  const outstanding = customers.filter(customer =>
    customerBalance(customer) > 0 || shopOwesBalance(customer) > 0
  );

  report.innerHTML = outstanding.length
    ? outstanding.map(customer => `
        <div style="padding:12px 0;border-bottom:1px solid var(--line);">
          <strong>${escapeLedgerHTML(customer.name)}</strong>
          <p>Customer owes us: ${money(customerBalance(customer))}</p>
          <p>We owe customer: ${money(shopOwesBalance(customer))}</p>
        </div>
      `).join("")
    : "<p>No outstanding balances yet.</p>";
}

function openCustomerAccount(id) {
  const customer = getCustomer(id);

  if (!customer) return;

  activeCustomerId = id;

  document.getElementById("customerAccountSection").style.display = "block";
  document.getElementById("customerAccountName").textContent = customer.name;
  document.getElementById("customerAccountMobile").textContent =
    customer.mobile || "No mobile number added";

  document.getElementById("customerTotalDue").textContent = money(customer.totalDue);
  document.getElementById("customerPaymentReceived").textContent = money(customer.received);
  document.getElementById("customerRemainingBalance").textContent =
    money(customerBalance(customer));
  document.getElementById("customerShopOwes").textContent =
    money(shopOwesBalance(customer));

  const history = document.getElementById("customerPaymentHistory");

  if (!customer.history.length) {
    history.innerHTML = "<p>No payment history yet.</p>";
  } else {
    history.innerHTML = [...customer.history].reverse().map(entry => `
      <div style="padding:12px 0;border-bottom:1px solid var(--line);">
        <strong>${escapeLedgerHTML(entry.label)}</strong>
        <p>Amount: ${money(entry.amount)}</p>
        <p>Date: ${escapeLedgerHTML(entry.date)}</p>
        <p>Time: ${escapeLedgerHTML(entry.time)}</p>
        <p>Note: ${escapeLedgerHTML(entry.note || "No note")}</p>
      </div>
    `).join("");
  }

  document.getElementById("customerPaymentForm").style.display = "none";
  document.getElementById("customerAccountSection").scrollIntoView({ behavior: "smooth" });
}


function closeCustomerAccount() {
  document.getElementById("customerAccountSection").style.display = "none";
  document.getElementById("customerPaymentForm").style.display = "none";
  activeCustomerId = null;
  customerPaymentMode = null;
}


function showCustomerPaymentForm(mode) {
  if (!activeCustomerId) return;

  customerPaymentMode = mode;
  
const paymentAmountInput = document.getElementById("customerPaymentAmount");
paymentAmountInput.step = ["received", "given"].includes(mode)
  ? data.numberSteps.payment
  : data.numberSteps.ledger;

  const titles = {
    received: "Record Payment Received",
    given: "Record Payment Given",
    addDue: "Add Amount Customer Owes Us",
    addOwe: "Add Amount We Owe Customer"
  };

  document.getElementById("customerPaymentFormTitle").textContent = titles[mode];
  document.getElementById("customerPaymentForm").style.display = "block";
  document.getElementById("customerPaymentDate").value = today();
  document.getElementById("customerPaymentAmount").value = "";
  document.getElementById("customerPaymentNote").value = "";
  document.getElementById("customerPaymentAmount").focus();
}

function hideCustomerPaymentForm() {
  document.getElementById("customerPaymentForm").style.display = "none";
  customerPaymentMode = null;
}

function saveCustomerPayment() {
  const customer = getCustomer(activeCustomerId);

  if (!customer || !customerPaymentMode) return;

  const amount = Number(document.getElementById("customerPaymentAmount").value);
  const date = document.getElementById("customerPaymentDate").value;
  const note = document.getElementById("customerPaymentNote").value.trim();

  if (!Number.isFinite(amount) || amount <= 0) {
    showCustomPopup("Invalid Amount", "Enter a valid amount greater than zero.", "error");
    return;
  }

  if (!date) {
    showCustomPopup("Date Required", "Please select the payment date.", "error");
    return;
  }

  const mode = customerPaymentMode;

  if (mode === "received" && amount > customerBalance(customer)) {
    showCustomPopup("Amount Too High", "Payment received cannot exceed the remaining customer due.", "error");
    return;
  }

  if (mode === "given" && amount > shopOwesBalance(customer)) {
    showCustomPopup("Amount Too High", "Payment given cannot exceed the amount we still owe this customer.", "error");
    return;
  }

  const changes = {
    addDue: () => {
      customer.totalDue += amount;
      return "New Customer Due";
    },
    received: () => {
      customer.received += amount;
      return "Payment Received";
    },
    addOwe: () => {
      customer.totalShopOwes += amount;
      return "New Amount We Owe";
    },
    given: () => {
      customer.given += amount;
      return "Payment Given";
    }
  };

  const label = changes[mode]();

  customer.history.push({
  id: "ledger_" + Date.now(),
  type: mode,
  label,
  amount,
  date,
  time: new Date().toLocaleTimeString("en-IN"),
  note,
  sessionNumber: currentDay()?.sessionNumber || null
});

  persist();
  hideCustomerPaymentForm();
  openCustomerAccount(customer.id);
  renderCustomerLedger();

  showCustomPopup("Ledger Updated", label + " has been recorded successfully.", "success");
}

function deleteCustomerLedgerEntry(customerId, entryId) {
  const customer = getCustomer(customerId);
  if (!customer) return;

  const index = (customer.history || []).findIndex(
    entry => String(entry.id) === String(entryId)
  );

  if (index === -1) return;

  showCustomConfirm(
    "Delete Ledger Entry?",
    "This entry will be removed from the customer balance and saved in Deleted Entries History.",
    () => {
      const entry = customer.history[index];
      const amount = Number(entry.amount) || 0;

      if (entry.type === "addDue") customer.totalDue -= amount;
      if (entry.type === "received") customer.received -= amount;
      if (entry.type === "addOwe") customer.totalShopOwes -= amount;
      if (entry.type === "given") customer.given -= amount;

      moveToDeletedHistory(
        { ...entry, customerId: customer.id, customerName: customer.name },
        "ledger",
        "Customer Ledger"
      );

      customer.history.splice(index, 1);
      persist();
      openCustomerAccount(customer.id);
      renderCustomerLedger();
      renderCustomerLedgerHistory();

      showCustomPopup("Deleted", "Ledger entry removed successfully.", "success");
    }
  );
}

window.deleteCustomerLedgerEntry = deleteCustomerLedgerEntry;
window.deleteBusinessEntry = deleteBusinessEntry;

function restoreDeletedEntry(deletedId) {
  const entry = (data.deletedEntries || []).find(
    item => String(item.deletedId) === String(deletedId)
  );

  if (!entry || entry.restoredAt) return;

  if (entry.deletedType === "ledger") {
    const customer = getCustomer(entry.customerId);

    if (!customer) {
      showCustomPopup("Restore Failed", "The original customer no longer exists.", "error");
      return;
    }

    customer.history = customer.history || [];

    if (customer.history.some(item => String(item.id) === String(entry.id))) {
      showCustomPopup("Already Exists", "This ledger entry is already present.", "error");
      return;
    }

    const amount = Number(entry.amount) || 0;

    if (entry.type === "addDue") customer.totalDue += amount;
    if (entry.type === "received") customer.received += amount;
    if (entry.type === "addOwe") customer.totalShopOwes += amount;
    if (entry.type === "given") customer.given += amount;

    customer.history.push({
  id: entry.id,
  type: entry.type,
  label: entry.label,
  amount,
  date: entry.date,
  time: entry.time,
  note: entry.note,
  sessionNumber: entry.sessionNumber || currentDay()?.sessionNumber || null
});

    openCustomerAccount(customer.id);
    renderCustomerLedger();
    renderCustomerLedgerHistory();

  } else {
    const day = currentDay();

    if (
      !day ||
      day.closed ||
      day.date !== entry.businessDate ||
      Number(day.sessionNumber) !== Number(entry.sessionNumber)
    ) {
      showCustomPopup(
        "Cannot Restore",
        "The original Business Shift is no longer open. Closed shifts cannot be edited.",
        "error"
      );
      return;
    }

    const list = entry.deletedType === "expense"
      ? day.expenses
      : entry.deletedType === "movement"
        ? day.cashMovements
        : day.transactions;

    if (list.some(item => String(item.id) === String(entry.id))) {
      showCustomPopup("Already Exists", "This entry is already present.", "error");
      return;
    }

    list.push({
      ...entry
    });

    if (entry.deletedType === "expense") renderExpenseList();
    if (entry.deletedType === "movement") renderCashMovements();
  }

  entry.restoredAt = new Date().toLocaleString("en-IN");

  persist();
  renderDeletedEntriesHistory();
  refreshDashboard();

  showCustomPopup("Restored", "Entry restored successfully.", "success");
}

window.renderDeletedEntriesHistory = renderDeletedEntriesHistory;
window.restoreDeletedEntry = restoreDeletedEntry;


function renderDeletedEntriesHistory() {
  const container = document.getElementById("deletedEntriesList");
  const searchInput = document.getElementById("deletedEntriesSearch");

  if (!container) return;

  const safe = value => escapeLedgerHTML(String(value ?? ""));
  const query = (searchInput?.value || "").trim().toLowerCase();
  const entries = (data.deletedEntries || []).slice().reverse();

  const filtered = entries.filter(entry =>
    [
      entry.deletedType,
      entry.deletedFrom,
      entry.category,
      entry.type,
      entry.serviceName,
      entry.platform,
      entry.customerName,
      entry.note,
      entry.originalDate
    ].some(value => String(value || "").toLowerCase().includes(query))
  );

  if (!filtered.length) {
    container.innerHTML = "<p>No deleted entries found.</p>";
    return;
  }

  container.innerHTML = filtered.map(entry => `
    <article class="ledger-history-entry">
      <strong>${safe(entry.deletedType || "Entry")} · ${safe(entry.deletedFrom || "")}</strong>
      <p><strong>Amount:</strong> ${money(entry.amount)}</p>
      <p><strong>Original date:</strong> ${safe(entry.originalDate || "Not available")}</p>
      <p><strong>Original time:</strong> ${safe(entry.originalTime || "Not available")}</p>
      <p><strong>Deleted on:</strong> ${safe(entry.deletedAt || "Not available")}</p>
      <p><strong>Note:</strong> ${safe(entry.note || "No note")}</p>
      ${entry.restoredAt
        ? `<p><strong>Status:</strong> Restored on ${safe(entry.restoredAt)}</p>`
        : `<button onclick="restoreDeletedEntry('${safe(entry.deletedId)}')">Restore</button>`}
    </article>
  `).join("");
}

function renderCustomerLedgerHistory() {
  const container = document.getElementById("customerLedgerHistoryList");
  const searchInput = document.getElementById("customerLedgerHistorySearch");

  if (!container) return;

  const query = (searchInput?.value || "").trim().toLowerCase();
  const entries = [];

  (data.customers || []).forEach(customer => {
    (customer.history || []).forEach(entry => {
      entries.push({
        ...entry,
        customerName: customer.name || "Unnamed customer", customerId: customer.id
      });
    });
  });

  entries.sort((a, b) => {
    const at = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const bt = b.timestamp ? new Date(b.timestamp).getTime() : 0;

    if (at && bt) return bt - at;
    if (at) return -1;
    if (bt) return 1;

    return String(b.date || "").localeCompare(String(a.date || "")) ||
      String(b.time || "").localeCompare(String(a.time || ""));
  });

  const filtered = entries.filter(entry =>
    [entry.customerName, entry.label, entry.type, entry.note]
      .some(value => String(value || "").toLowerCase().includes(query))
  );

  if (!filtered.length) {
    container.innerHTML =
      '<p class="customer-ledger-empty">No customer ledger entries found.</p>';
    return;
  }

  const labels = {
    addDue: "Amount Due Added",
    received: "Payment Received",
    addOwe: "Amount We Owe Added",
    given: "Payment Given"
  };

  container.innerHTML = filtered.map(entry => {
    const label = labels[entry.type] || entry.label || "Ledger Entry";

    return `
      <article class="ledger-history-entry">
        <div class="ledger-history-heading">
          <strong>${escapeLedgerHTML(entry.customerName)}</strong>
          <strong>${escapeLedgerHTML(money(entry.amount))}</strong>
        </div>
        <p class="ledger-history-type">${escapeLedgerHTML(label)}</p>
        <p><strong>Date:</strong> ${escapeLedgerHTML(entry.date || "Not available")}</p>
        <p><strong>Time:</strong> ${escapeLedgerHTML(entry.time || "Time not available")}</p>
        <p><strong>Note:</strong> ${escapeLedgerHTML(entry.note || "No note")}</p>
        <button onclick="deleteCustomerLedgerEntry('${entry.customerId}', '${entry.id}')">Delete</button>
      </article>
    `;
  }).join("");
}

/* ==================================
   FIREBASE LOGIN
================================== */

function getLoginEmail() {
  const email = document.getElementById("loginEmail").value.trim().toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Enter a valid email address.");
  }

  return email;
}

function showLoginMessage(message, isError = true) {
  const element = document.getElementById("loginMessage");

  if (!element) return;

  element.textContent = message;
  element.style.color = isError ? "#dc2626" : "#16834a";
}

async function signInWithGoogle() {
  try {
    const provider = new GoogleAuthProvider();

    if (auth.currentUser) {
      await linkWithPopup(auth.currentUser, provider);
      showLoginMessage("Google Sign-In has been linked to this account.", false);
      return;
    }

    await signInWithPopup(auth, provider);

  } catch (error) {
    if (error.code === "auth/account-exists-with-different-credential") {
      showLoginMessage("This email already has a password account. Sign in with that email and password first, then click CONTINUE WITH GOOGLE again to link both methods.");
    } else {
      showLoginMessage(error.message || "Google sign-in failed.");
    }
  }
}

async function signInWithEmail() {
  const password = document.getElementById("loginPassword").value;

  if (!password) {
    return showLoginMessage("Please enter your password.");
  }

  try {
    await signInWithEmailAndPassword(auth, getLoginEmail(), password);
    document.getElementById("confirmPasswordGroup").style.display = "none";
  } catch (error) {
    showLoginMessage("Sign-in failed. Check your email and password.");
  }
}

async function createAccount() {
  const password = document.getElementById("loginPassword").value;
  const confirmGroup = document.getElementById("confirmPasswordGroup");
  const confirmPassword = document.getElementById("confirmPassword");

  if (confirmGroup.style.display === "none") {
    confirmGroup.style.display = "block";
    showLoginMessage("Enter your password again to confirm, then click CREATE ACCOUNT.", false);
    confirmPassword.focus();
    return;
  }

  if (!password || !confirmPassword.value) {
    return showLoginMessage("Please enter and confirm your password.");
  }

  if (password.length < 6) {
    return showLoginMessage("Password must be at least 6 characters.");
  }

  if (password !== confirmPassword.value) {
    return showLoginMessage("Passwords do not match.");
  }

  try {
    await createUserWithEmailAndPassword(auth, getLoginEmail(), password);
  } catch (error) {
    showLoginMessage(
      error.code === "auth/email-already-in-use"
        ? "This email already has an account. Please sign in instead."
        : (error.message || "Account creation failed.")
    );
  }
}

async function resetPassword() {
  try {
    await sendPasswordResetEmail(auth, getLoginEmail());
    showLoginMessage("Password reset email sent. Check your inbox and spam folder.", false);
  } catch (error) {
    showLoginMessage(
      error.code === "auth/user-not-found"
        ? "No account was found for this email."
        : (error.message || "Could not send the reset email.")
    );
  }
}

async function logoutUser() {
  try {
    if (currentUser && currentDeviceId) {
      const deviceRef = doc(
        db,
        "users",
        currentUser.uid,
        "sessions",
        currentDeviceId
      );

      await updateDoc(deviceRef, {
        active: false,
        revoked: false
      });
    }

    await signOut(auth);
  } catch (error) {
    showCustomPopup("Sign Out Failed", error.message, "error");
  }
}

async function linkGoogleAccount() {
  if (!auth.currentUser) {
    showLoginMessage("Please sign in first.");
    return;
  }

  try {
    const provider = new GoogleAuthProvider();

    await linkWithPopup(auth.currentUser, provider);

    showCustomPopup(
      "Google Account Linked",
      "Google Sign-In is now linked to your existing account.",
      "success"
    );

  } catch (error) {
    let message = error.message;

    if (error.code === "auth/credential-already-in-use") {
      message = "This Google account is already connected to another account. Automatic account merging is not supported.";
    }

    showCustomPopup(
      "Google Linking Failed",
      message,
      "error"
    );
  }
}

window.linkGoogleAccount = linkGoogleAccount;


/* ==================================
   APP STARTUP
================================== */

function showCustomPopup(title, message, type = "success", details = "") {
  const popup = document.getElementById("customPopup");
  const icon = document.getElementById("popupIcon");

  document.getElementById("popupTitle").textContent = title;
  document.getElementById("popupMessage").textContent = message;
  document.getElementById("popupDetails").innerHTML = details;

  if (type === "error") {
    icon.textContent = "!";
    icon.style.background = "#fee2e2";
    icon.style.color = "#dc2626";
  } else {
    icon.textContent = "✓";
    icon.style.background = "#e6f8ed";
    icon.style.color = "#16a34a";
  }

  popup.style.display = "flex";
}

function closeCustomPopup() {
  document.getElementById("customPopup").style.display = "none";

  pendingPopupAction = null;

  document.getElementById("popupCancelButton").style.display = "none";

  const okButton = document.getElementById("popupOkButton");
  okButton.textContent = "OK, GOT IT";
  okButton.onclick = closeCustomPopup;
}

let pendingPopupAction = null;

function showCustomConfirm(title, message, action) {
  pendingPopupAction = action;

  document.getElementById("popupTitle").textContent = title;
  document.getElementById("popupMessage").textContent = message;

  document.getElementById("popupCancelButton").style.display = "inline-block";

  const okButton = document.getElementById("popupOkButton");
  okButton.textContent = "CONFIRM";
  okButton.onclick = confirmCustomPopup;

  document.getElementById("customPopup").style.display = "flex";
}

function confirmCustomPopup() {
  const action = pendingPopupAction;
  pendingPopupAction = null;
  closeCustomPopup();

  document.getElementById("popupCancelButton").style.display = "none";

  const okButton = document.getElementById("popupOkButton");
  okButton.textContent = "OK, GOT IT";
  okButton.onclick = closeCustomPopup;

  if (action) action();
}

window.alert = function(message) {
  showCustomPopup("Aditya Multi Services", String(message), "success");
};
/* ==================================
   SIDE MENU ACTIONS
================================== */

let appScreenHistory = [];
function openAppScreen(screenName, skipHistory = false) {
    const isPreStart = !data.currentDay || data.currentDay.closed;

  const allowedBeforeStart = [
    "deleted-history",
    "opening",
    "history",
    "customer-ledger",
    "customer-history",
    "reports",
    "settings"
  ];

  if (isPreStart && !allowedBeforeStart.includes(screenName)) {
    screenName = "opening";
  }
  const screens = document.querySelectorAll(".app-screen");
  const activeScreen = document.querySelector(".app-screen.active");
  const currentScreenName = activeScreen
  ? activeScreen.id.replace("screen-", "")
  : "";

  screens.forEach(screen => {
    screen.classList.remove("active");
  });

  const selectedScreen = document.getElementById("screen-" + screenName);
  if (!selectedScreen) return;
 
  if (
  !skipHistory &&
  currentScreenName &&
  currentScreenName !== screenName
) {
  appScreenHistory.push(currentScreenName);
}

  selectedScreen.classList.add("active");
  
  const backButton = document.getElementById("appBackButton");

if (backButton) {
  backButton.style.display =
    appScreenHistory.length > 0 ? "inline-flex" : "none";
}

  if (screenName === "deleted-history") {
  renderDeletedEntriesHistory();
}
  
  if (screenName === "settings") {
  loadDeviceList();
  }
  
if (screenName === "home") {
  setTimeout(() => {
    drawBusinessPerformanceChart();
  }, 300);
}

  const footer = document.querySelector("footer");
  const menuButton = document.querySelector(".menu-toggle");
  const isOpening = screenName === "opening";
  // Hide Add New Customer until the business day starts
const addCustomerButton = document.querySelector(
  "#screen-customer-ledger button[onclick='showAddCustomerForm()']"
);

if (addCustomerButton) {
  addCustomerButton.style.display = isPreStart ? "none" : "";
}

  // Keep business name and date visible
  if (footer) {
  footer.style.display = isOpening ? "none" : "";
}

  // Make the menu button smaller on Opening Balances
  if (menuButton) {
    menuButton.style.padding = isOpening ? "5px 9px" : "";
    menuButton.style.fontSize = isOpening ? "12px" : "";
  }

  // Show only useful menu options before starting the day
  document.querySelectorAll(".drawer-nav a").forEach(link => {
    const action = link.getAttribute("onclick") || "";

  const allowedOnOpening = [
  "deleted-history",
  "opening",
  "history",
  "customer-ledger",
  "customer-history",
  "reports",
  "settings"
];

    const isAllowed = allowedOnOpening.some(name =>
      action.includes("openAppScreen('" + name + "')")
    );

 const isOpeningLink = action.includes("openAppScreen('opening')");

    link.style.display = isPreStart
      ? (isAllowed ? "" : "none")
      : (isOpeningLink ? "none" : "");
  });

  // Keep Dark/Light Mode and Sign Out, hide Google linking
  const drawerActions = document.querySelector(".drawer-actions");

  if (drawerActions) {
    drawerActions.querySelectorAll("button").forEach(button => {
      const action = button.getAttribute("onclick") || "";
   button.style.display = action.includes("linkGoogleAccount")
        ? (isPreStart ? "none" : "")
        : "";
    });
  }

  closeDrawer();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

window.openAppScreen = openAppScreen;

function goBackAppScreen() {
  const previousScreen = appScreenHistory.pop() || "home";
  openAppScreen(previousScreen, true);
}

window.goBackAppScreen = goBackAppScreen;

function moveHeaderActionsToMenu() {
  const drawer = document.getElementById("sideDrawer");
  if (!drawer) return;

  let actions = drawer.querySelector(".drawer-actions");

  if (!actions) {
    actions = document.createElement("div");
    actions.className = "drawer-actions";
    actions.innerHTML = "<strong>Account & Appearance</strong>";
    drawer.appendChild(actions);
  }

  const themeButton = document.getElementById("themeToggle");
  const headerButtons = document.querySelectorAll("header button");

  let googleButton = null;
  let signOutButton = null;

  headerButtons.forEach(button => {
    const action = button.getAttribute("onclick") || "";

    if (action.includes("linkGoogleAccount")) {
      googleButton = button;
    }

    if (action.includes("logoutUser")) {
      signOutButton = button;
    }
  });

  if (themeButton) {
    themeButton.textContent =
      document.documentElement.dataset.theme === "dark"
        ? "LIGHT MODE"
        : "DARK MODE";

    actions.appendChild(themeButton);
  }

  if (googleButton) {
    googleButton.textContent = "LINK GOOGLE ACCOUNT";
    actions.appendChild(googleButton);
  }

  if (signOutButton) {
    signOutButton.textContent = "SIGN OUT";
    signOutButton.classList.add("sign-out-button");
    actions.appendChild(signOutButton);
  }
}

function addMenuIcons() {
  const iconMap = {
    "Dashboard": "layout-dashboard",
    "Opening Balances": "wallet",
    "New Transaction": "plus-circle",
    "Services": "printer",
    "Wallet Management": "landmark",
    "Daily Closing": "clipboard-check",
    "History & Calendar": "calendar-days",
    "Customer Ledger": "users",
    "Deleted Entries History": "trash-2",
    "Cash In / Cash Out": "arrow-left-right",
    "Expenses": "receipt",
    "Reports": "chart-no-axes-combined",
    "Settings": "settings"
  };

  const paths = {
    "layout-dashboard": '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
    "wallet": '<rect x="3" y="6" width="18" height="15" rx="2"/><path d="M3 10h18M16 15h2"/><path d="M6 6V4h12"/>',
    "plus-circle": '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
    "printer": '<path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v7H6z"/>',
    "landmark": '<path d="M3 21h18M4 10h16M5 10V21M9 10V21M15 10V21M19 10V21M2 10l10-7 10 7"/>',
    "clipboard-check": '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2h6v2M8 13l2 2 5-5"/>',
    "calendar-days": '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01"/>',
    "users": '<path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    "trash-2": '<path d="M3 6h18M8 6V4h8v2M19 6l-1 15H6L5 6M10 11v6M14 11v6"/>',
    "arrow-left-right": '<path d="M17 3l4 4-4 4M3 7h18M7 21l-4-4 4-4M21 17H3"/>',
    "receipt": '<path d="M4 3h16v18l-4-2-4 2-4-2-4 2zM8 8h8M8 12h8M8 16h4"/>',
    "chart-no-axes-combined": '<path d="M3 3v18h18M7 14l4-4 4 4 6-7"/>',
    "settings": '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-1.7 1.7-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1 1.55V20h-2.4v-.21a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.88.34l-.06.06-1.7-1.7.06-.06A1.7 1.7 0 0 0 8.4 15a1.7 1.7 0 0 0-1.55-1H6v-2.4h.85a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.88L8 8.66l1.7-1.7.06.06a1.7 1.7 0 0 0 1.88.34 1.7 1.7 0 0 0 1-1.55V5h2.4v.81a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.88-.34l.06-.06 1.7 1.7-.06.06A1.7 1.7 0 0 0 19.4 10a1.7 1.7 0 0 0 1.55 1H21v2.4h-.05a1.7 1.7 0 0 0-1.55 1.6z"/>'
  };

  document.querySelectorAll(".drawer-nav a").forEach(link => {
    const label = link.textContent.trim();
    const iconName = iconMap[label];

    if (!iconName || link.querySelector(".menu-icon")) return;

    const icon = document.createElement("span");
    icon.className = "menu-icon";
    icon.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        ${paths[iconName]}
      </svg>
    `;

    link.prepend(icon);
  });
}

/* ==================================
   DEVICE REGISTRATION AND TRACKING
================================== */

const DEVICE_ID_KEY = "aditya_multi_services_device_id";

let currentDeviceId = null;
let unsubscribeDeviceListener = null;
let deviceHeartbeat = null;

async function getDeviceName() {
  const ua = navigator.userAgent || "";
  const uaData = navigator.userAgentData;

  // Try to get the actual model from browser device information
  if (uaData && typeof uaData.getHighEntropyValues === "function") {
    try {
      const info = await uaData.getHighEntropyValues([
        "model",
        "platform"
      ]);

      const model = (info.model || "").trim();

      if (model) {
  if (model.toUpperCase() === "RMX5101") {
    return "realme 15 Pro 5G";
  }

  if (/Samsung|SM-/i.test(ua) || /^SM-/i.test(model)) {
    return "Samsung " + model.replace(/^Samsung\s*/i, "");
  }

  return model;
}
    } catch (error) {
      console.warn("Device model detection unavailable:", error);
    }
  }

  // Fallback: detect Samsung model number from the user agent
  const samsungModel = ua.match(/\b(SM-[A-Z0-9]+)\b/i);

  if (samsungModel) {
    return "Samsung " + samsungModel[1].toUpperCase();
  }

  // Fallback: detect other Android device model names
  const androidModel = ua.match(
    /Android[^;)]*;\s*([^;)]+?)(?:\s+Build\/|[;)])/i
  );

 if (androidModel && !/^(?:wv|mobile|tablet)$/i.test(androidModel[1].trim())) {
  const model = androidModel[1].trim().toUpperCase();

  if (model === "RMX5101") {
    return "realme 15 Pro 5G";
  }

  return androidModel[1].trim();
}

  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Windows/i.test(ua)) return "Windows PC";
  if (/Macintosh/i.test(ua)) return "Mac";
  if (/Android/i.test(ua)) return "Android Device";

  return "Other Device";
}

async function registerCurrentDevice(user) {
  if (!user || !user.uid) return;

  currentDeviceId = localStorage.getItem(DEVICE_ID_KEY);

  if (!currentDeviceId) {
    currentDeviceId = crypto.randomUUID
      ? crypto.randomUUID()
      : "device-" + Date.now() + "-" + Math.random().toString(36).slice(2);

    localStorage.setItem(DEVICE_ID_KEY, currentDeviceId);
  }

  const deviceRef = doc(
    db,
    "users",
    user.uid,
    "sessions",
    currentDeviceId
  );

  await setDoc(deviceRef, {
    deviceId: currentDeviceId,
    deviceName: await getDeviceName(),
    userAgent: navigator.userAgent,
    active: true,
    revoked: false,
    lastSeen: serverTimestamp(),
    signedInAt: serverTimestamp()
  }, { merge: true });

  if (unsubscribeDeviceListener) {
    unsubscribeDeviceListener();
  }

  unsubscribeDeviceListener = onSnapshot(deviceRef, snapshot => {
    if (!snapshot.exists()) return;

    const session = snapshot.data();

    if (session.revoked === true) {
      signOut(auth);
    }
  });

  if (deviceHeartbeat) {
    clearInterval(deviceHeartbeat);
  }

  deviceHeartbeat = setInterval(async () => {
    if (!auth.currentUser || auth.currentUser.uid !== user.uid) return;

    try {
     
      await updateDoc(deviceRef, {
    lastSeen: serverTimestamp()
  });
      
    } catch (error) {
      console.error("Device activity update failed:", error);
    }
  }, 60000);

  window.addEventListener("focus", updateDeviceActivity);
}

async function updateDeviceActivity() {
  if (!currentUser || !currentDeviceId) return;

  try {
    await setDoc(
      doc(db, "users", currentUser.uid, "sessions", currentDeviceId),
      {
   lastSeen: serverTimestamp()
  },
      { merge: true }
    );
  } catch (error) {
    console.error("Device activity update failed:", error);
  }
}

function stopDeviceTracking() {
    if (unsubscribeDeviceList) {
    unsubscribeDeviceList();
    unsubscribeDeviceList = null;
  }
  if (unsubscribeDeviceListener) {
    unsubscribeDeviceListener();
    unsubscribeDeviceListener = null;
  }

  if (deviceHeartbeat) {
    clearInterval(deviceHeartbeat);
    deviceHeartbeat = null;
  }

  window.removeEventListener("focus", updateDeviceActivity);
  currentDeviceId = null;
}

/* ==================================
   DEVICE MANAGEMENT
================================== */

let unsubscribeDeviceList = null;

async function loadDeviceList() {
  if (!currentUser) return;

  const list = document.getElementById("deviceList");
  const count = document.getElementById("deviceCount");

  try {
    const sessionsRef = collection(
      db,
      "users",
      currentUser.uid,
      "sessions"
    );

    if (unsubscribeDeviceList) {
  unsubscribeDeviceList();
  unsubscribeDeviceList = null;
}
    
    unsubscribeDeviceList = onSnapshot(sessionsRef, snapshot => {

    count.textContent = `Registered Devices: ${snapshot.size}`;

    if (snapshot.empty) {
      list.textContent = "No registered devices found.";
      return;
    }

    list.innerHTML = "";

    snapshot.forEach(docSnap => {
      const device = docSnap.data();

      const item = document.createElement("div");
      item.className = "card";

      const name = document.createElement("strong");
      name.textContent = device.deviceName || "Unknown Device";

      const status = document.createElement("p");

      if (docSnap.id === currentDeviceId) {
      status.textContent = "This Device";
    } else if (device.revoked === true || device.active === false) {
      status.textContent = "Signed Out";
    } else {
     status.textContent = "Active";
    }

      const active = document.createElement("p");
      active.textContent = device.lastSeen
        ? "Last active: " + device.lastSeen.toDate().toLocaleString()
        : "Last active: Unknown";

      item.append(name, status, active);

      if (
  docSnap.id !== currentDeviceId &&
  device.revoked !== true &&
  device.active !== false
) {
        const button = document.createElement("button");
        button.textContent = "SIGN OUT THIS DEVICE";

        button.onclick = () => {
          showCustomConfirm(
            "Sign Out Device",
            "Are you sure you want to sign out this device?",
            async () => {
              await updateDoc(docSnap.ref, {
                revoked: true,
                active: false
              });

              showCustomPopup(
                "Device Signed Out",
                "The selected device has been signed out.",
                "success"
              );
            }
          );
        };

        item.appendChild(button);
      }

      list.appendChild(item);
    });
  });

  } catch (error) {
    console.error("Device list error:", error);
    list.textContent = "Unable to load devices.";
  }
}

async function signOutOtherDevices() {
  if (!currentUser) return;

  showCustomConfirm(
    "Sign Out Other Devices",
    "Are you sure you want to sign out all other devices?",
    async () => {
      try {
        const sessionsRef = collection(
          db,
          "users",
          currentUser.uid,
          "sessions"
        );

        const snapshot = await getDocs(sessionsRef);

        for (const deviceDoc of snapshot.docs) {
          if (deviceDoc.id === currentDeviceId) continue;

          await updateDoc(deviceDoc.ref, {
            revoked: true,
            active: false
          });
        }

        await loadDeviceList();

        showCustomPopup(
          "Completed",
          "All other devices have been signed out.",
          "success"
        );

      } catch (error) {
        console.error("Sign out other devices failed:", error);
        showCustomPopup(
          "Error",
          "Unable to sign out other devices.",
          "error"
        );
      }
    }
  );
        }

/* ==================================
   LOAD USER BUSINESS DATA
================================== */

async function loadUserBusinessData(user) {
  currentUser = user;
  activeStorageKey = `${KEY}_${user.uid}`;

  const localCopy = localStorage.getItem(activeStorageKey);

  try {
    const snapshot = await getDoc(
      doc(db, "users", user.uid, "appData", "main")
    );

    if (snapshot.exists() && snapshot.data().data) {
      data = normalizeData(snapshot.data().data);
      localStorage.setItem(activeStorageKey, JSON.stringify(data));

    } else if (localCopy) {
      data = normalizeData(JSON.parse(localCopy));

      // Restore only this account's own local copy.
      // The old shared localStorage data is never imported.
      await setDoc(
        doc(db, "users", user.uid, "appData", "main"),
        {
          data,
          updatedAt: serverTimestamp()
        }
      );

    } else {
      data = emptyData();
    }

  } catch (error) {
    console.error("Cloud load failed:", error);

    data = localCopy
      ? normalizeData(JSON.parse(localCopy))
      : emptyData();

    showLoginMessage(
      "Cloud connection unavailable. Showing this account's device copy."
    );
  }
    if (unsubscribeCloudListener) {
    unsubscribeCloudListener();
    unsubscribeCloudListener = null;
  }

  unsubscribeCloudListener = onSnapshot(
    doc(db, "users", user.uid, "appData", "main"),
    (snapshot) => {
      if (!currentUser || currentUser.uid !== user.uid) return;

      if (snapshot.exists() && snapshot.data().data) {
        const wasPreStart = !data.currentDay || data.currentDay.closed;

data = normalizeData(snapshot.data().data);

const isPreStart = !data.currentDay || data.currentDay.closed;

if (wasPreStart && !isPreStart) {
  openAppScreen("home");
} else if (!wasPreStart && isPreStart) {
  openAppScreen("opening");
}

        localStorage.setItem(
          activeStorageKey,
          JSON.stringify(data)
        );

        updateTransactionFields();
        updateServiceFields();
        updateServicePaymentFields();
        renderCustomerLedgerHistory();
        renderTodayCompleteHistory();
        refreshDashboard();
        renderCalendar();
      }
    },
    (error) => {
      console.error("Real-time cloud sync failed:", error);
    }
  );
  
  updateTransactionFields();
  updateServiceFields();
  updateServicePaymentFields();
  renderCustomerLedgerHistory();
  renderNumberStepSettings();
  renderDashboardVisibilitySettings();
  refreshDashboard();
  applyDashboardVisibility();
  drawBusinessPerformanceChart();
  renderCalendar();
}

/* ==================================
   CHECK LOGIN STATUS
================================== */

onAuthStateChanged(auth, async (user) => {
  const loginScreen = document.getElementById("loginScreen");
  const header = document.querySelector("header");
  const main = document.querySelector("main");

  if (user) {
    loginScreen.style.display = "none";
    header.style.display = "";
    main.style.display = "";

    currentUser = user;
       await loadUserBusinessData(user);
   try {
  await registerCurrentDevice(user);
} catch (error) {
  console.error("Device registration failed:", error);
    }
    await loadDeviceList();

    if (data.currentDay && !data.currentDay.closed) {
      openAppScreen("home");
    } else {
      openAppScreen("opening");
    }

  } else {
    stopDeviceTracking();
    if (unsubscribeCloudListener) {
      unsubscribeCloudListener();
      unsubscribeCloudListener = null;
    }
    
    currentUser = null;
    activeStorageKey = null;
    data = emptyData();

    const passwordInput = document.getElementById("loginPassword");
    const toggleButton = document.querySelector(".password-toggle");

    if (passwordInput) {
      passwordInput.value = "";
      passwordInput.type = "password";
    }

    if (toggleButton) {
      toggleButton.textContent = "SHOW";
    }

    const confirmPassword = document.getElementById("confirmPassword");
    if (confirmPassword) confirmPassword.value = "";

    loginScreen.style.display = "flex";
    header.style.display = "none";
    main.style.display = "none";
  }
});

/* ==================================
   DARK / LIGHT THEME
================================== */

function applyTheme(theme) {
  const selected = theme === "dark" ? "dark" : "light";

  document.documentElement.dataset.theme = selected;

  const button = document.getElementById("themeToggle");

  if (button) {
    button.textContent = selected === "dark" ? "LIGHT MODE" : "DARK MODE";
  }

  localStorage.setItem(THEME_KEY, selected);
}

function toggleTheme() {
  applyTheme(
    document.documentElement.dataset.theme === "dark"
      ? "light"
      : "dark"
  );
}

applyTheme(localStorage.getItem(THEME_KEY) || "light");
moveHeaderActionsToMenu();
addMenuIcons();

/* ==================================
   INITIALIZE APP
================================== */

updateTransactionFields();
updateServiceFields();
updateServicePaymentFields();
initializeCustomerLedger();
renderCustomerLedgerHistory();
refreshDashboard();
renderNumberStepSettings();
setupNumberWheelSteps();

Object.assign(window,{ 
  openAppScreen,
  exportPDF,
  exportPDF,
  closeReportPopup,
  exportExcel,
  toggleCustomReportDates,
  generateReport,
  saveCashMovement,
  saveExpense,
  togglePasswordVisibility,
  updateNumberStep,
  startBusinessDay,
  updateTransactionFields,
  calculateChargePreview,
  addBusinessTransaction,
  addOnlineWithdrawal,
  updateServiceFields,
  calculateServiceTotal,
  updateServicePaymentFields,
  calculateServiceSplit,
  addServiceTransaction,
  previewClosing,
  saveBusinessDay,
  showHistory,
  changeCalendarMonth,
  selectHistoryDate,
  renderCalendar,
  toggleTheme,
  exportData,
  showCustomPopup,
  closeCustomPopup,
  signInWithGoogle,
  signInWithEmail,
  createAccount,
  resetPassword,
  showLoginMessage,
  logoutUser,
  signOutOtherDevices,
  showAddCustomerForm,
  hideAddCustomerForm,
  addLedgerCustomer,
  renderCustomerLedger,
  renderCustomerLedgerHistory,
  openCustomerAccount,
  closeCustomerAccount,
  showCustomerPaymentForm,
  hideCustomerPaymentForm,
  saveCustomerPayment,
  openTodayTransactions,
  openTodayServices,
  openTodayWithdrawals,
  closeDashboardHistory,
  showDashboardHistory,
  renderDashboardVisibilitySettings,
  applyDashboardVisibility,
  updateDashboardVisibility,
});
