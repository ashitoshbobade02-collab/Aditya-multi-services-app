

const STORAGE_KEY = "aditya_multi_services_v1";

const defaultData = {
  days: [],
  currentDay: null
};

function loadData() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || defaultData;
  } catch {
    return defaultData;
  }
}

function saveData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function createDay(biznextOpening, roinetOpening, cashOpening) {
  return {
    date: new Date().toISOString().slice(0, 10),
    opening: {
      biznext: Number(biznextOpening) || 0,
      roinet: Number(roinetOpening) || 0,
      cash: Number(cashOpening) || 0
    },
    transactions: [],
    closed: false
  };
}

function calculateDay(day) {
  let biznextAEPS = 0;
  let roinetAEPS = 0;
  let cash = day.opening.cash;
  let online = 0;
  let profit = 0;

  day.transactions.forEach(t => {
    const amount = Number(t.amount) || 0;
    const charge = Number(t.customerCharge) || 0;

    if (t.type === "AEPS") {
      if (t.platform === "Biznext") biznextAEPS += amount;
      if (t.platform === "Roinet") roinetAEPS += amount;

      cash -= amount;
      profit += charge;
    }

    if (t.type === "C+") {
      cash += amount;
      online -= amount;
      profit += charge;
    }

    if (t.type === "C-") {
      cash -= amount;
      online += amount;
      profit += charge;
    }

    if (t.type === "OTHER") {
      cash += Number(t.cashChange) || 0;
    }
  });

  return {
    biznextClosing: day.opening.biznext + biznextAEPS,
    roinetClosing: day.opening.roinet + roinetAEPS,
    totalAEPS: biznextAEPS + roinetAEPS,
    cashExpected: cash,
    onlineNet: online,
    dailyProfit: profit
  };
}

function addTransaction(day, transaction) {
  if (day.closed) {
    throw new Error("This day is already closed.");
  }

  day.transactions.push({
    id: crypto.randomUUID(),
    time: new Date().toISOString(),
    ...transaction
  });

  return day;
}

function verifyCash(day, actualCash) {
  const result = calculateDay(day);
  const difference = Number(actualCash) - result.cashExpected;

  return {
    expected: result.cashExpected,
    actual: Number(actualCash),
    difference,
    status:
      difference === 0 ? "Matched" :
      difference < 0 ? "Shortage" : "Excess"
  };
}

function closeDay(day, actualCash) {
  if (day.closed) {
    throw new Error("Day is already closed.");
  }

  const report = calculateDay(day);
  const verification = verifyCash(day, actualCash);

  day.closing = {
    ...report,
    ...verification,
    closedAt: new Date().toISOString()
  };

  day.closed = true;
  return day;
}

function saveDay(day) {
  const data = loadData();

  if (data.days.some(d => d.date === day.date)) {
    throw new Error("A record for this date already exists.");
  }

  data.days.push(day);
  data.currentDay = null;
  saveData(data);

  return data;
}

function getMonthlyHistory(year, month) {
  return loadData().days.filter(day => {
    const date = new Date(day.date + "T00:00:00");
    return date.getFullYear() === year &&
           date.getMonth() === month;
  });
}

function exportData() {
  const data = loadData();
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
