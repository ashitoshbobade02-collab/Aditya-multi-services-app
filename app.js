
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
    fino: "openingFino"
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
      : Number(document.getElementById("openingFino").value)
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

function calculateTotals(day) {
  const totals = {
    biznext: day.opening.biznext || 0,
    roinet: day.opening.roinet || 0,
    tez: day.opening.tez || 0,
    fino: day.opening.fino || 0,
    aeps: 0,
    cash: day.opening.cash,
    online: day.opening.online,
    profit: 0,
    business: 0,
    charges: 0
  };

  day.transactions.forEach(t => {
    const amount = Number(t.amount) || 0;
    const charge = Number(t.charge) || 0;

    totals.business += amount;

    if (t.type === "AEPS") {
      totals.aeps += amount;

      if (t.platform === "Biznext") totals.biznext += amount;
      if (t.platform === "Roinet") totals.roinet += amount;
      if (t.platform === "Tez") totals.tez += amount;
      if (t.platform === "Fino") totals.fino += amount;

      totals.cash -= amount;
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

    totals.cash += charge;
    totals.charges += charge;
    totals.profit += charge;
  });

  return totals;
}

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
    "biznextCollection", "roinetCollection", "tezCollection",
    "finoCollection", "cashBalance", "onlineBalance",
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

    return;
  }

  const t = calculateTotals(day);

  document.getElementById("biznextBalance").textContent = money(t.biznext);
  document.getElementById("roinetBalance").textContent = money(t.roinet);
  document.getElementById("tezBalance").textContent = money(t.tez);
  document.getElementById("finoBalance").textContent = money(t.fino);

  document.getElementById("biznextCollection").textContent =
    money(t.biznext - day.opening.biznext);

  document.getElementById("roinetCollection").textContent =
    money(t.roinet - day.opening.roinet);

  document.getElementById("tezCollection").textContent =
    money(t.tez - day.opening.tez);

  document.getElementById("finoCollection").textContent =
    money(t.fino - day.opening.fino);

  document.getElementById("cashBalance").textContent = money(t.cash);
  document.getElementById("onlineBalance").textContent = money(t.online);
  document.getElementById("totalBusiness").textContent = money(t.business);
  document.getElementById("dailyProfit").textContent = money(t.profit);

  document.getElementById("openingSection").style.display = "none";

  const list = document.getElementById("transactionList");

  if (!day.transactions.length) {
    list.innerHTML = "<p>No transactions recorded yet.</p>";
  } else {
    list.innerHTML = day.transactions.map(t => `
      <div style="padding:12px 0;border-bottom:1px solid #e2eaf2">
        <strong>${t.type} ${t.platform ? "· " + t.platform : ""}</strong>
        <p>${t.time}</p>
        <p>Amount: ${money(t.amount)}</p>
        <p>Customer charge: ${money(t.charge)}</p>
      </div>
    `).join("");
  }
}

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

  // Carry forward only the four portal wallet balances.
  data.walletCarryForward = {
    biznext: totals.biznext,
    roinet: totals.roinet,
    tez: totals.tez,
    fino: totals.fino
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

updateTransactionFields();
refreshDashboard();
