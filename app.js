
const KEY = "aditya_multi_services_v3";

let data = JSON.parse(
  localStorage.getItem(KEY) || '{"days":[],"currentDay":null}'
);

if (!data.walletCarryForward) {
  data.walletCarryForward = null;
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
  localStorage.setItem(KEY, JSON.stringify(data));
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
    time: new Date().toLocaleTimeString("en-IN"),
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

  alert("Service saved successfully!");
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
    alert("Start a business day first.");
    return;
  }

  const type = document.getElementById("transactionType").value;
  const amount =
    Number(document.getElementById("transactionAmount").value);

  if (!Number.isFinite(amount) || amount <= 0) {
    alert("Enter a valid transaction amount.");
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
    alert("Insufficient online balance.");
    return;
  }

  if (type === "C-" && amount + charge > totals.cash) {
    alert("Insufficient cash balance.");
    return;
  }

  if (type === "AEPS" && amount > totals.cash) {
    alert("Insufficient cash balance.");
    return;
  }

  day.transactions.push(transaction);
  persist();

  document.getElementById("transactionAmount").value = "";
  document.getElementById("customerCharge").value = "";

  calculateChargePreview();
  refreshDashboard();

  alert("Transaction saved successfully!");
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

  alert("Online balance withdrawal saved successfully!");
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
   "sbiBalance",
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
  const history = document.getElementById("historyList");

  const days = data.days.filter(d =>
    d.date.startsWith(today().slice(0, 7))
  );

  if (!days.length) {
    history.innerHTML = "<p>No saved records this month.</p>";
    return;
  }

  history.innerHTML = days.map(d => `
    <div style="padding:12px 0;border-bottom:1px solid #e2eaf2">
      <strong>${d.date}</strong>
      <p>Business: ${money(d.closing.business)}</p>
      <p>Profit: ${money(d.closing.profit)}</p>
      <p>Cash difference: ${money(d.closing.difference)}</p>
    </div>
  `).join("");
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
   APP STARTUP
================================== */

updateTransactionFields();
updateServiceFields();
updateServicePaymentFields();
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
  exportData
 });
