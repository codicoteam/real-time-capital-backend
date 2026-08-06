"use strict";

const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/investor/title_deed_controller");
const {
  investorOrPawnAdminMiddleware,
  requireInvestorAdminOrPawnSuperAdmin,
} = require("../../middlewares/investor_or_pawn_admin_middleware");

const guard = [investorOrPawnAdminMiddleware, requireInvestorAdminOrPawnSuperAdmin];

router.post("/",             ...guard, ctrl.create);
router.get("/",              ...guard, ctrl.list);
router.get("/:id",           ...guard, ctrl.getOne);
router.put("/:id",           ...guard, ctrl.update);
router.delete("/:id",        ...guard, ctrl.remove);
router.post("/:id/documents",        ...guard, ctrl.addDocument);
router.delete("/:id/documents/:docId", ...guard, ctrl.removeDocument);

module.exports = router;
