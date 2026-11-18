import { db, auth } from "./firebase.js";
import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-firestore.js";

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
const emptyData = () => ({
  days: [],
  currentDay: null,
  walletCarryForward: null,
  customers: []
});
let data = emptyData();
let currentUser = null;
let activeStorageKey = null;
let cloudWriteQueue = Promise.resolve();
let calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let selectedHistoryDate = today();

function normalizeData(value) {
  const clean = value && typeof value === "object" ? value : emptyData();
  if (!Array.isArray(clean.days)) clean.days = [];
  if (!Array.isArray(clean.customers)) clean.customers = [];
  if (!Object.prototype.hasOwnProperty.call(clean, "currentDay")) clean.currentDay = null;
  if (!Object.prototype.hasOwnProperty.call(clean, "walletCarryForward")) clean.walletCarryForward = null;
  return clean;
}

function money(value) {
  return "₹" + Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function today() {
  const d = new Date();
  return d.getFullYear() + "-" +
    String(d.getMonth() + 1).padStart(2, "0") + "-" +
    String(d.getDate()).padStart(2, "0");
}

function persist() {
  if (!currentUser || !activeStorageKey) return;
  const snapshot = JSON.stringify(data);
  localStorage.setItem(activeStorageKey, snapshot);
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

  if (Object.values(opening).some(v => !Number.isFinite(v) || v < 0)) {
    alert("Enter valid opening balances.");
    return;
  }

  data.currentDay = {
    date: today(),
    opening,
    transactions: [],
    closed: false
  };

  persist();
  refreshDashboard();
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
    <strong>Service:</strong> ${serviceName}
    <br>
    <strong>Amount:</strong> ${money(amount)}
  </div>`
);
}

/* ==================================
   BUSINESS CALCULATIONS
================================== */

function calculateTotals(day) {
  const totals = {
    biznext: day.opening.biznext || 0,
    roinet: day.opening.roinet || 0,
    tez: day.opening.tez || 0,
    fino: day.opening.fino || 0,
    sbi: day.opening.sbi || 0,
    aeps: 0,
    cash: day.opening.cash,
    online: day.opening.online,
    profit: 0,
    business: 0,
    charges: 0,
    serviceIncome: 0
  };

  day.transactions.forEach(t => {
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
    }

    totals.cash += charge;
    totals.charges += charge;
    totals.profit += charge;
  });

  return totals;
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

  const platform = type === "AEPS"
    ? document.getElementById("platform").value
    : "";

  const transaction = {
    id: Date.now(),
    time: new Date().toLocaleTimeString("en-IN"),
    type,
    amount,
    charge,
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

  if (type === "C-" && amount + charge > totals.cash) {
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

function refreshDashboard() {
  const day = currentDay();

  document.getElementById("todayDate").textContent =
    new Date().toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric"
    });

  const walletIds = [
    "biznextBalance", "roinetBalance", "tezBalance", "finoBalance",
    "sbiBalance", "combinedCollection",
    "biznextCollection", "roinetCollection", "tezCollection",
    "finoCollection", "sbiCollection",
    "cashBalance", "onlineBalance",
    "totalBusiness", "dailyProfit"
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

  document.getElementById("biznextBalance").textContent = money(t.biznext);
  document.getElementById("roinetBalance").textContent = money(t.roinet);
  document.getElementById("tezBalance").textContent = money(t.tez);
  document.getElementById("finoBalance").textContent = money(t.fino);
  document.getElementById("sbiBalance").textContent = money(t.sbi);

  document.getElementById("biznextCollection").textContent =
    money(t.biznext - day.opening.biznext);

  document.getElementById("roinetCollection").textContent =
    money(t.roinet - day.opening.roinet);

  document.getElementById("tezCollection").textContent =
    money(t.tez - day.opening.tez);

  document.getElementById("finoCollection").textContent =
    money(t.fino - day.opening.fino);

  document.getElementById("sbiCollection").textContent =
    money(t.sbi - day.opening.sbi);

  const combinedBiznextRoinet = day.transactions
    .filter(transaction => transaction.type === "AEPS" && ["Biznext", "Roinet"].includes(transaction.platform))
    .reduce((sum, transaction) => sum + (Number(transaction.amount) || 0), 0);

  document.getElementById("combinedCollection").textContent =
    money(combinedBiznextRoinet);

  document.getElementById("cashBalance").textContent = money(t.cash);
  document.getElementById("onlineBalance").textContent = money(t.online);
  document.getElementById("totalBusiness").textContent = money(t.business);
  document.getElementById("dailyProfit").textContent = money(t.profit);

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

  const list = document.getElementById("transactionList");

  if (!day.transactions.length) {
    list.innerHTML = "<p>No transactions recorded yet.</p>";
  } else {
    list.innerHTML = day.transactions.map(t => {
      if (t.type === "ONLINE_WITHDRAWAL") {
        return `
          <div style="padding:12px 0;border-bottom:1px solid #e2eaf2">
            <strong>Online Balance Withdrawal · ${t.platform}</strong>
            <p>${t.time}</p>
            <p>Amount: ${money(t.amount)}</p>
            <p>Note: ${t.note || "No note"}</p>
          </div>
        `;
      }

      if (t.type === "SERVICE") {
        const quantityText = t.quantity
          ? "Quantity: " + t.quantity
          : "Direct amount entry";

        return `
          <div style="padding:12px 0;border-bottom:1px solid #e2eaf2">
            <strong>${t.serviceName}</strong>
            <p>${t.time}</p>
            <p>${quantityText}</p>
            <p>Amount: ${money(t.amount)}</p>
            <p>Payment: ${t.paymentMethod}</p>
            <p>Cash: ${money(t.cashAmount)} | Online: ${money(t.onlineAmount)}</p>
          </div>
        `;
      }

      return `
        <div style="padding:12px 0;border-bottom:1px solid #e2eaf2">
          <strong>${t.type} ${t.platform ? "· " + t.platform : ""}</strong>
          <p>${t.time}</p>
          <p>Amount: ${money(t.amount)}</p>
          <p>Customer charge: ${money(t.charge)}</p>
        </div>
      `;
    }).join("");
  }
}

/* ==================================
   DAILY CLOSING
================================== */

function previewClosing() {
  const day = currentDay();

  if (!day) {
    alert("Start a business day first.");
    return;
  }

  const actual = Number(document.getElementById("actualCash").value);

  if (!Number.isFinite(actual) || actual < 0) {
    alert("Enter actual cash available.");
    return;
  }

  const expected = calculateTotals(day).cash;
  const difference = actual - expected;

  document.getElementById("closingResult").innerHTML = `
    <div style="margin-top:15px;padding:15px;background:#eaf4ff;border-radius:12px">
      <p>Expected cash: <strong>${money(expected)}</strong></p>
      <p>Actual cash: <strong>${money(actual)}</strong></p>
      <p>Difference: <strong style="color:${difference < 0 ? '#d94343' : '#168653'}">${money(difference)}</strong></p>
      <p>${difference === 0 ? "Cash matched" : difference < 0 ? "Cash shortage" : "Cash excess"}</p>
    </div>
  `;
}

function saveBusinessDay() {
  const day = currentDay();

  if (!day) {
    alert("No active business day.");
    return;
  }

  if (day.closed) {
    alert("This day is already saved and closed.");
    return;
  }

  const actual = Number(document.getElementById("actualCash").value);

  if (!Number.isFinite(actual) || actual < 0) {
    alert("Enter actual cash and check the difference first.");
    return;
  }

  if (!confirm("Save and close this business day? This cannot be edited from the dashboard.")) {
    return;
  }

  const totals = calculateTotals(day);

  day.closing = {
    ...totals,
    actualCash: actual,
    difference: actual - totals.cash,
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

  data.days.push(day);
  data.currentDay = null;

  persist();

  document.getElementById("openingSection").style.display = "block";
  document.getElementById("closingResult").innerHTML = "";
  document.getElementById("actualCash").value = "";

  refreshDashboard();

  alert("Business day saved! Portal balances are ready for the next day.");
}

/* ==================================
   HISTORY AND BACKUP
================================== */

function showHistory() {
  renderCalendar();
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
  const history = document.getElementById("historyList");
  if (!history) return;

  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();

  const monthLabel = calendarMonth.toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric"
  });

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const saved = new Map(data.days.map(day => [day.date, day]));

  if (data.currentDay) {
    saved.set(data.currentDay.date, data.currentDay);
  }

  const cells = [];

  for (let i = 0; i < firstDay; i++) {
    cells.push('<span class="calendar-empty"></span>');
  }

  for (let dayNumber = 1; dayNumber <= daysInMonth; dayNumber++) {
    const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(dayNumber).padStart(2, "0")}`;
    const hasRecord = saved.has(date);
    const selected = date === selectedHistoryDate ? " selected" : "";

    cells.push(`<button type="button" class="calendar-day${hasRecord ? " has-record" : ""}${selected}" onclick="selectHistoryDate('${date}')">${dayNumber}</button>`);
  }

  const selectedDay = saved.get(selectedHistoryDate);

  let detail = '<p class="muted">No business record for this date.</p>';

  if (selectedDay) {
    const closing = selectedDay.closing || calculateTotals(selectedDay);
    const transactions = selectedDay.transactions || [];

    detail = `<div class="history-summary">
      <p><strong>${selectedHistoryDate}</strong> ${selectedDay.closed ? '<span class="record-tag">Closed</span>' : '<span class="record-tag active-tag">In progress</span>'}</p>
      <p>Business: <strong>${money(closing.business)}</strong></p>
      <p>Profit: <strong>${money(closing.profit)}</strong></p>
      <p>Cash difference: <strong>${selectedDay.closing ? money(selectedDay.closing.difference) : 'Not closed'}</strong></p>
      <h4>Transactions (${transactions.length})</h4>
      ${transactions.length ? transactions.map(t => `<div class="history-transaction"><strong>${t.type === "SERVICE" ? (t.serviceName || "Service") : (t.type === "ONLINE_WITHDRAWAL" ? `${t.platform} Withdrawal` : `${t.type} ${t.platform ? "· " + t.platform : ""}`)}</strong><span>${t.time || ""}</span><p>Amount: ${money(t.amount)}</p>${t.type === "SERVICE" ? `<p>Payment: ${t.paymentMethod || ""}</p>` : `<p>Charge: ${money(t.charge)}</p>`}</div>`).join("") : '<p>No transactions recorded.</p>'}
    </div>`;
  }

  history.innerHTML = `<div class="calendar-header"><button type="button" class="calendar-nav" onclick="changeCalendarMonth(-1)" aria-label="Previous month">‹</button><strong>${monthLabel}</strong><button type="button" class="calendar-nav" onclick="changeCalendarMonth(1)" aria-label="Next month">›</button></div>
    <div class="calendar-grid calendar-weekdays">${["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(x => `<span>${x}</span>`).join("")}</div>
    <div class="calendar-grid">${cells.join("")}</div>
    <p class="calendar-legend"><span></span> Dates with saved business records</p>${detail}`;
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
    note
  });

  persist();
  hideCustomerPaymentForm();
  openCustomerAccount(customer.id);
  renderCustomerLedger();

  showCustomPopup("Ledger Updated", label + " has been recorded successfully.", "success");
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
        customerName: customer.name || "Unnamed customer"
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
}

/* ==================================
   SIDE MENU ACTIONS
================================== */

function openAppScreen(screenName) {
  const screens = document.querySelectorAll(".app-screen");

  screens.forEach(screen => {
    screen.classList.remove("active");
  });

  const selectedScreen = document.getElementById("screen-" + screenName);
  if (!selectedScreen) return;

  selectedScreen.classList.add("active");

  const footer = document.querySelector("footer");
  const menuButton = document.querySelector(".menu-toggle");
  const isOpening = screenName === "opening";

  // Keep business name and date visible
  footer.style.display = isOpening ? "none" : "";

  // Make the menu button smaller on Opening Balances
  if (menuButton) {
    menuButton.style.padding = isOpening ? "5px 9px" : "";
    menuButton.style.fontSize = isOpening ? "12px" : "";
  }

  // Show only useful menu options before starting the day
  document.querySelectorAll(".drawer-nav a").forEach(link => {
    const action = link.getAttribute("onclick") || "";

    const allowedOnOpening = [
      "history",
      "customer-ledger",
      "customer-history",
      "reports",
      "settings"
    ];

    const isAllowed = allowedOnOpening.some(name =>
      action.includes("openAppScreen('" + name + "')")
    );

    link.style.display = isOpening
      ? (isAllowed ? "" : "none")
      : "";
  });

  // Keep Dark/Light Mode and Sign Out, hide Google linking
  const drawerActions = document.querySelector(".drawer-actions");

  if (drawerActions) {
    drawerActions.querySelectorAll("button").forEach(button => {
      const action = button.getAttribute("onclick") || "";
      button.style.display = action.includes("linkGoogleAccount")
        ? (isOpening ? "none" : "")
        : "";
    });
  }

  closeDrawer();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

window.openAppScreen = openAppScreen;

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
    "Dashboard": "🏠",
    "Opening Balances": "💰",
    "New Transaction": "➕",
    "Services": "🖨️",
    "Wallet Management": "👛",
    "Daily Closing": "📋",
    "History & Calendar": "📅",
    "Customer Ledger": "👥",
    "Cash In / Cash Out": "💸",
    "Expenses": "🧾",
    "Reports": "📊",
    "Settings": "⚙️",
    "LIGHT MODE": "☀️",
    "DARK MODE": "🌙",
    "LINK GOOGLE ACCOUNT": "🔗",
    "SIGN OUT": "🚪"
  };

  const menu = document.querySelector(".side-drawer");

  if (!menu) return;

  menu.querySelectorAll("a, button").forEach(element => {
    const label = element.textContent.trim().replace(/\s+/g, " ").toUpperCase();

    const matchedLabel = Object.keys(iconMap).find(
      name => name.toUpperCase() === label
    );

    if (!matchedLabel) return;

    if (element.querySelector(".menu-icon")) return;

    const icon = document.createElement("span");
    icon.className = "menu-icon";
    icon.textContent = iconMap[matchedLabel];

    element.prepend(icon);
  });
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

  updateTransactionFields();
  updateServiceFields();
  updateServicePaymentFields();
  renderCustomerLedgerHistory();
  refreshDashboard();
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

    await loadUserBusinessData(user);
    openAppScreen("home");

  } else {
    currentUser = null;
    activeStorageKey = null;
    data = emptyData();

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

Object.assign(window, {
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
});
