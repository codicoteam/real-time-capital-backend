"use strict";

const mongoose = require("mongoose");
const TitleDeed = require("../../models/investor/title_deed.model");

let _deedCounter = null;

async function nextDeedNumber() {
  const last = await TitleDeed.findOne({}, { deed_number: 1 }).sort({ created_at: -1 });
  if (!last) return "TD-0001";
  const match = last.deed_number.match(/(\d+)$/);
  const n = match ? parseInt(match[1], 10) + 1 : 1;
  return `TD-${String(n).padStart(4, "0")}`;
}

const titleDeedController = {
  async create(req, res) {
    try {
      const actorId = req.investor?._id || req.pawnAdmin?._id || null;
      const {
        investor_id,
        property_name,
        property_address,
        property_description,
        property_lat,
        property_lng,
        loan_amount,
        interest_rate,
        loan_term_months,
        investor_share_pct,
        start_date,
        end_date,
        status,
        borrower_name,
        borrower_id_number,
        borrower_phone,
        documents,
        notes,
        deed_number,
      } = req.body;

      if (!investor_id) return res.status(400).json({ success: false, message: "investor_id is required" });
      if (!property_name) return res.status(400).json({ success: false, message: "property_name is required" });
      if (!loan_amount && loan_amount !== 0) return res.status(400).json({ success: false, message: "loan_amount is required" });

      if (investor_id && !mongoose.Types.ObjectId.isValid(investor_id)) {
        return res.status(400).json({ success: false, message: "Invalid investor_id" });
      }

      const finalDeedNumber = deed_number ? String(deed_number).trim().toUpperCase() : await nextDeedNumber();

      const deed = await TitleDeed.create({
        deed_number: finalDeedNumber,
        investor_id,
        property_name,
        property_address,
        property_description,
        property_lat: property_lat !== undefined && property_lat !== null ? Number(property_lat) : null,
        property_lng: property_lng !== undefined && property_lng !== null ? Number(property_lng) : null,
        loan_amount,
        interest_rate,
        loan_term_months,
        investor_share_pct: investor_share_pct !== undefined ? investor_share_pct : 100,
        start_date,
        end_date,
        status: status || "pending",
        borrower_name,
        borrower_id_number,
        borrower_phone,
        documents: Array.isArray(documents) ? documents : [],
        notes,
        created_by: actorId,
      });

      const populated = await TitleDeed.findById(deed._id).populate("investor_id", "name email kind avatar_color");
      return res.status(201).json({ success: true, message: "Title deed created", data: { title_deed: populated } });
    } catch (err) {
      if (err.code === 11000) {
        return res.status(409).json({ success: false, message: "Deed number already exists" });
      }
      console.error("[TitleDeedController] create error:", err);
      return res.status(500).json({ success: false, message: "Server error" });
    }
  },

  async list(req, res) {
    try {
      const { investor_id, status, search, page = 1, limit = 50 } = req.query;
      const filter = {};
      if (investor_id) {
        if (!mongoose.Types.ObjectId.isValid(investor_id)) {
          return res.status(400).json({ success: false, message: "Invalid investor_id" });
        }
        filter.investor_id = investor_id;
      }
      if (status) filter.status = status;
      if (search) {
        const q = { $regex: search, $options: "i" };
        filter.$or = [
          { deed_number: q },
          { property_name: q },
          { borrower_name: q },
          { property_address: q },
        ];
      }

      const skip = (Number(page) - 1) * Number(limit);
      const [deeds, total] = await Promise.all([
        TitleDeed.find(filter)
          .populate("investor_id", "name email kind avatar_color")
          .sort({ created_at: -1 })
          .skip(skip)
          .limit(Number(limit)),
        TitleDeed.countDocuments(filter),
      ]);

      return res.json({
        success: true,
        data: {
          title_deeds: deeds,
          pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / Number(limit)) },
        },
      });
    } catch (err) {
      console.error("[TitleDeedController] list error:", err);
      return res.status(500).json({ success: false, message: "Server error" });
    }
  },

  async getOne(req, res) {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: "Invalid id" });
      }
      const deed = await TitleDeed.findById(id).populate("investor_id", "name email kind avatar_color");
      if (!deed) return res.status(404).json({ success: false, message: "Title deed not found" });
      return res.json({ success: true, data: { title_deed: deed } });
    } catch (err) {
      console.error("[TitleDeedController] getOne error:", err);
      return res.status(500).json({ success: false, message: "Server error" });
    }
  },

  async update(req, res) {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: "Invalid id" });
      }

      const allowed = [
        "investor_id",
        "property_name",
        "property_address",
        "property_description",
        "property_lat",
        "property_lng",
        "loan_amount",
        "interest_rate",
        "loan_term_months",
        "investor_share_pct",
        "start_date",
        "end_date",
        "status",
        "borrower_name",
        "borrower_id_number",
        "borrower_phone",
        "documents",
        "notes",
      ];
      const updates = {};
      for (const key of allowed) {
        if (req.body[key] !== undefined) updates[key] = req.body[key];
      }

      const deed = await TitleDeed.findByIdAndUpdate(id, { $set: updates }, { new: true, runValidators: true })
        .populate("investor_id", "name email kind avatar_color");
      if (!deed) return res.status(404).json({ success: false, message: "Title deed not found" });
      return res.json({ success: true, message: "Title deed updated", data: { title_deed: deed } });
    } catch (err) {
      console.error("[TitleDeedController] update error:", err);
      return res.status(500).json({ success: false, message: "Server error" });
    }
  },

  async remove(req, res) {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: "Invalid id" });
      }
      const deed = await TitleDeed.findByIdAndDelete(id);
      if (!deed) return res.status(404).json({ success: false, message: "Title deed not found" });
      return res.json({ success: true, message: "Title deed deleted", data: { id } });
    } catch (err) {
      console.error("[TitleDeedController] remove error:", err);
      return res.status(500).json({ success: false, message: "Server error" });
    }
  },

  async addDocument(req, res) {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: "Invalid id" });
      }
      const { url, filename, mime_type, label } = req.body;
      if (!url || !filename) {
        return res.status(400).json({ success: false, message: "url and filename are required" });
      }
      const deed = await TitleDeed.findByIdAndUpdate(
        id,
        { $push: { documents: { url, filename, mime_type, label } } },
        { new: true, runValidators: true },
      ).populate("investor_id", "name email kind avatar_color");
      if (!deed) return res.status(404).json({ success: false, message: "Title deed not found" });
      return res.json({ success: true, message: "Document added", data: { title_deed: deed } });
    } catch (err) {
      console.error("[TitleDeedController] addDocument error:", err);
      return res.status(500).json({ success: false, message: "Server error" });
    }
  },

  async removeDocument(req, res) {
    try {
      const { id, docId } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: "Invalid id" });
      }
      const deed = await TitleDeed.findByIdAndUpdate(
        id,
        { $pull: { documents: { _id: docId } } },
        { new: true },
      ).populate("investor_id", "name email kind avatar_color");
      if (!deed) return res.status(404).json({ success: false, message: "Title deed not found" });
      return res.json({ success: true, message: "Document removed", data: { title_deed: deed } });
    } catch (err) {
      console.error("[TitleDeedController] removeDocument error:", err);
      return res.status(500).json({ success: false, message: "Server error" });
    }
  },
};

module.exports = titleDeedController;
