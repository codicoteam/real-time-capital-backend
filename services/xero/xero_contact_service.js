"use strict";

const { getAuthenticatedClient } = require("./xero_client_service");
const User = require("../../models/user.model");
const Investor = require("../../models/investor/investor.model");

async function findExistingByContactNumber(accountingApi, tenantId, contactNumber) {
  try {
    const { body } = await accountingApi.getContactByContactNumber(tenantId, contactNumber);
    return (body.contacts && body.contacts[0]) || null;
  } catch (err) {
    if (err.response && err.response.status === 404) return null;
    throw err;
  }
}

// Upserts a Xero Contact for a pawn customer, on demand — called right before the first
// transaction that needs it. Result cached onto User.xero_contact_id.
async function getOrCreateCustomerContact(userId) {
  const user = await User.findById(userId).select("first_name last_name email phone xero_contact_id");
  if (!user) throw new Error(`User ${userId} not found for Xero contact sync.`);
  if (user.xero_contact_id) return user.xero_contact_id;

  const { accountingApi, tenantId } = await getAuthenticatedClient();
  const contactNumber = `RTC-CUST-${user._id}`;

  const existing = await findExistingByContactNumber(accountingApi, tenantId, contactNumber);
  if (existing) {
    user.xero_contact_id = existing.contactID;
    await user.save();
    return existing.contactID;
  }

  const name = `${user.first_name || ""} ${user.last_name || ""}`.trim() || user.email || contactNumber;
  const { body } = await accountingApi.createContacts(tenantId, {
    contacts: [
      {
        contactNumber,
        name,
        emailAddress: user.email || undefined,
        phones: user.phone ? [{ phoneType: "MOBILE", phoneNumber: user.phone }] : undefined,
      },
    ],
  });
  const created = body.contacts[0];
  user.xero_contact_id = created.contactID;
  await user.save();
  return created.contactID;
}

// Same as above, for an Investor (individual, company, company_client, or the internal
// "rtc"/"admin" pseudo-investor accounts — they all get a real Xero contact so their
// capital/profit ledger reconciles like any other creditor).
async function getOrCreateInvestorContact(investorId) {
  const investor = await Investor.findById(investorId).select("name email phone xero_contact_id");
  if (!investor) throw new Error(`Investor ${investorId} not found for Xero contact sync.`);
  if (investor.xero_contact_id) return investor.xero_contact_id;

  const { accountingApi, tenantId } = await getAuthenticatedClient();
  const contactNumber = `RTC-INV-${investor._id}`;

  const existing = await findExistingByContactNumber(accountingApi, tenantId, contactNumber);
  if (existing) {
    investor.xero_contact_id = existing.contactID;
    await investor.save();
    return existing.contactID;
  }

  const { body } = await accountingApi.createContacts(tenantId, {
    contacts: [
      {
        contactNumber,
        name: investor.name || contactNumber,
        emailAddress: investor.email || undefined,
        phones: investor.phone ? [{ phoneType: "MOBILE", phoneNumber: investor.phone }] : undefined,
      },
    ],
  });
  const created = body.contacts[0];
  investor.xero_contact_id = created.contactID;
  await investor.save();
  return created.contactID;
}

// A single shared contact for BankTransactions that don't have a natural customer/investor
// counterparty (e.g. operating expenses paid to a variety of vendors we don't track
// individually in this system). Cached in-process — cheap to re-resolve if the process restarts.
let internalContactId = null;

async function getOrCreateInternalContact() {
  if (internalContactId) return internalContactId;

  const { accountingApi, tenantId } = await getAuthenticatedClient();
  const contactNumber = "RTC-INTERNAL";

  const existing = await findExistingByContactNumber(accountingApi, tenantId, contactNumber);
  if (existing) {
    internalContactId = existing.contactID;
    return internalContactId;
  }

  const { body } = await accountingApi.createContacts(tenantId, {
    contacts: [{ contactNumber, name: "Real Time Capital — Operating Expenses" }],
  });
  internalContactId = body.contacts[0].contactID;
  return internalContactId;
}

module.exports = { getOrCreateCustomerContact, getOrCreateInvestorContact, getOrCreateInternalContact };
