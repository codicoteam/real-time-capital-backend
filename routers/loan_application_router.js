const express = require("express");
const router = express.Router();
const loanApplicationController = require("../controllers/loan_application_controller");
const {
  authMiddleware,
  requireRoles,
} = require("../middlewares/auth_middleware");

/**
 * @swagger
 * tags:
 *   name: Loan Applications
 *   description: Loan application management for pawn system
 */

/**
 * @swagger
 * components:
 *   securitySchemes:
 *     bearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 */

/**
 * @swagger
 * /api/v1/loan-applications:
 *   post:
 *     summary: Create a new loan application (draft)
 *     tags: [Loan Applications]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - full_name
 *               - national_id_number
 *               - requested_loan_amount
 *               - collateral_category
 *             properties:
 *               full_name:
 *                 type: string
 *               national_id_number:
 *                 type: string
 *               gender:
 *                 type: string
 *               date_of_birth:
 *                 type: string
 *                 format: date
 *               marital_status:
 *                 type: string
 *               contact_details:
 *                 type: string
 *               alternative_number:
 *                 type: string
 *               email_address:
 *                 type: string
 *                 format: email
 *               home_address:
 *                 type: string
 *               employment:
 *                 type: object
 *                 properties:
 *                   employment_type:
 *                     type: string
 *                   title:
 *                     type: string
 *                   duration:
 *                     type: string
 *                   location:
 *                     type: string
 *                   contacts:
 *                     type: string
 *               requested_loan_amount:
 *                 type: number
 *                 minimum: 0
 *               collateral_category:
 *                 type: string
 *                 enum: [small_loans, motor_vehicle, jewellery]
 *               collateral_description:
 *                 type: string
 *               surety_description:
 *                 type: string
 *               declared_asset_value:
 *                 type: number
 *               declaration_text:
 *                 type: string
 *     responses:
 *       201:
 *         description: Loan application draft created successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.post(
  "/",
  authMiddleware,
  requireRoles("customer"),
  loanApplicationController.createLoanApplication
);

/**
 * @swagger
 * /api/v1/loan-applications:
 *   get:
 *     summary: Get all loan applications with pagination
 *     tags: [Loan Applications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *         description: Number of records per page
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           default: created_at
 *         description: Field to sort by
 *       - in: query
 *         name: sortOrder
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *         description: Sort order
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [draft, submitted, processing, approved, rejected, cancelled]
 *         description: Filter by status
 *       - in: query
 *         name: collateral_category
 *         schema:
 *           type: string
 *           enum: [small_loans, motor_vehicle, jewellery]
 *         description: Filter by collateral category
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search in application number, name, or ID
 *       - in: query
 *         name: customer_user
 *         schema:
 *           type: string
 *         description: Filter by customer user ID (admin only)
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter applications created after this date
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter applications created before this date
 *     responses:
 *       200:
 *         description: Loan applications retrieved successfully
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get(
  "/",
  authMiddleware,
  requireRoles(
    "super_admin_vendor",
    "admin_pawn_limited",
    "call_centre_support",
    "loan_officer_processor",
    "loan_officer_approval",
    "management",
    "customer"
  ),
  loanApplicationController.getLoanApplications
);

/**
 * @swagger
 * /api/v1/loan-applications/{id}:
 *   get:
 *     summary: Get a single loan application by ID
 *     tags: [Loan Applications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Loan application ID
 *     responses:
 *       200:
 *         description: Loan application retrieved successfully
 *       400:
 *         description: Invalid ID format
 *       404:
 *         description: Loan application not found
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (role-based access)
 *       500:
 *         description: Server error
 */
router.get(
  "/:id",
  authMiddleware,
  requireRoles(
    "super_admin_vendor",
    "admin_pawn_limited",
    "call_centre_support",
    "loan_officer_processor",
    "loan_officer_approval",
    "management",
    "customer"
  ),
  loanApplicationController.getLoanApplicationById
);

/**
 * @swagger
 * /api/v1/loan-applications/{id}:
 *   put:
 *     summary: Update loan application details
 *     tags: [Loan Applications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Loan application ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               full_name:
 *                 type: string
 *               national_id_number:
 *                 type: string
 *               gender:
 *                 type: string
 *               date_of_birth:
 *                 type: string
 *                 format: date
 *               marital_status:
 *                 type: string
 *               contact_details:
 *                 type: string
 *               alternative_number:
 *                 type: string
 *               email_address:
 *                 type: string
 *                 format: email
 *               home_address:
 *                 type: string
 *               employment:
 *                 type: object
 *               requested_loan_amount:
 *                 type: number
 *               collateral_description:
 *                 type: string
 *               surety_description:
 *                 type: string
 *               declared_asset_value:
 *                 type: number
 *               declaration_text:
 *                 type: string
 *     responses:
 *       200:
 *         description: Loan application updated successfully
 *       400:
 *         description: Bad request
 *       404:
 *         description: Loan application not found
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.put(
  "/:id",
  authMiddleware,
  requireRoles(
    "customer",
    "loan_officer_processor",
    "loan_officer_approval",
    "super_admin_vendor",
    "admin_pawn_limited",
    "management"
  ),
  loanApplicationController.updateLoanApplication
);

/**
 * @swagger
 * /api/v1/loan-applications/{id}/submit:
 *   post:
 *     summary: Submit a draft loan application
 *     tags: [Loan Applications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Loan application ID
 *     responses:
 *       200:
 *         description: Loan application submitted successfully
 *       400:
 *         description: Bad request or missing required fields
 *       404:
 *         description: Loan application not found
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.post(
  "/:id/submit",
  authMiddleware,
  requireRoles("customer"),
  loanApplicationController.submitLoanApplication
);

/**
 * @swagger
 * /api/v1/loan-applications/{id}/status:
 *   put:
 *     summary: Update loan application status (admin/loan officer)
 *     tags: [Loan Applications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Loan application ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - status
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [processing, approved, rejected, cancelled]
 *               notes:
 *                 type: string
 *                 description: Optional notes about the status change
 *     responses:
 *       200:
 *         description: Status updated successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 *       404:
 *         description: Loan application not found
 *       500:
 *         description: Server error
 */
router.put(
  "/:id/status",
  authMiddleware,
  requireRoles(
    "loan_officer_processor",
    "loan_officer_approval",
    "super_admin_vendor",
    "admin_pawn_limited",
    "management"
  ),
  loanApplicationController.updateLoanApplicationStatus
);

/**
 * @swagger
 * /api/v1/loan-applications/{id}/debtor-check:
 *   post:
 *     summary: Perform debtor check on loan application
 *     tags: [Loan Applications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Loan application ID
 *     responses:
 *       200:
 *         description: Debtor check completed successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 *       404:
 *         description: Loan application not found
 *       500:
 *         description: Server error
 */
router.post(
  "/:id/debtor-check",
  authMiddleware,
  requireRoles(
    "loan_officer_processor",
    "loan_officer_approval",
    "super_admin_vendor",
    "admin_pawn_limited",
    "management"
  ),
  loanApplicationController.performDebtorCheck
);

/**
 * @swagger
 * /api/v1/loan-applications/{id}/attachments:
 *   post:
 *     summary: Add attachment to loan application
 *     tags: [Loan Applications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Loan application ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - attachmentId
 *             properties:
 *               attachmentId:
 *                 type: string
 *                 description: ID of the attachment to add
 *     responses:
 *       200:
 *         description: Attachment added successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Loan application or attachment not found
 *       500:
 *         description: Server error
 */
router.post(
  "/:id/attachments",
  authMiddleware,
  requireRoles(
    "customer",
    "loan_officer_processor",
    "loan_officer_approval",
    "super_admin_vendor",
    "admin_pawn_limited",
    "management"
  ),
  loanApplicationController.addAttachment
);

/**
 * @swagger
 * /api/v1/loan-applications/{id}/attachments/{attachmentId}:
 *   delete:
 *     summary: Remove attachment from loan application
 *     tags: [Loan Applications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Loan application ID
 *       - in: path
 *         name: attachmentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Attachment ID to remove
 *     responses:
 *       200:
 *         description: Attachment removed successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Loan application or attachment not found
 *       500:
 *         description: Server error
 */
router.delete(
  "/:id/attachments/:attachmentId",
  authMiddleware,
  requireRoles(
    "customer",
    "loan_officer_processor",
    "loan_officer_approval",
    "super_admin_vendor",
    "admin_pawn_limited",
    "management"
  ),
  loanApplicationController.removeAttachment
);

/**
 * @swagger
 * /api/v1/loan-applications/{id}/request-documents:
 *   post:
 *     summary: Request additional documents from customer
 *     tags: [Loan Applications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Loan application ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - requiredDocuments
 *             properties:
 *               requiredDocuments:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: List of required documents
 *     responses:
 *       200:
 *         description: Document request sent successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 *       404:
 *         description: Loan application not found
 *       500:
 *         description: Server error
 */
router.post(
  "/:id/request-documents",
  authMiddleware,
  requireRoles(
    "loan_officer_processor",
    "loan_officer_approval",
    "super_admin_vendor",
    "admin_pawn_limited",
    "management"
  ),
  loanApplicationController.sendDocumentRequirement
);

/**
 * @swagger
 * /api/v1/loan-applications/stats:
 *   get:
 *     summary: Get loan application statistics
 *     tags: [Loan Applications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Statistics retrieved successfully
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get(
  "/stats",
  authMiddleware,
  requireRoles(
    "super_admin_vendor",
    "admin_pawn_limited",
    "loan_officer_processor",
    "loan_officer_approval",
    "management",
    "customer"
  ),
  loanApplicationController.getStatistics
);

/**
 * @swagger
 * /api/v1/loan-applications/export:
 *   get:
 *     summary: Export loan applications to CSV/Excel
 *     tags: [Loan Applications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: format
 *         schema:
 *           type: string
 *           enum: [csv, excel]
 *           default: csv
 *         description: Export format
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *         description: Filter by status
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter applications created after this date
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter applications created before this date
 *     responses:
 *       200:
 *         description: Export file generated
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get(
  "/export",
  authMiddleware,
  requireRoles("super_admin_vendor", "admin_pawn_limited", "management"),
  async (req, res) => {
    // Export implementation placeholder
    res.status(200).json({
      success: true,
      message: "Export endpoint - implement CSV/Excel generation here",
    });
  }
);

module.exports = router;
