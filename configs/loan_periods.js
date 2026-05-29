const LOAN_PERIODS = {
  two_weeks: {
    label: "2 Weeks",
    days: 14,
    interest_rate_percent: 2,
    storage_charge_percent: 18,
  },
  one_month: {
    label: "1 Month",
    days: 30,
    interest_rate_percent: 4,
    storage_charge_percent: 21,
  },
};

const LOAN_PERIOD_TYPES = Object.keys(LOAN_PERIODS);

module.exports = { LOAN_PERIODS, LOAN_PERIOD_TYPES };
