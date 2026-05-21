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
 *   schemas:
 *     SmallLoanDetails:
 *       type: object
 *       properties:
 *         type:
 *           type: string
 *         model:
 *           type: string
 *         serial_no:
 *           type: string
 *     MotorVehicleDetails:
 *       type: object
 *       properties:
 *         make:
 *           type: string
 *         model:
 *           type: string
 *         registration_no:
 *           type: string
 *         cc_serial_no:
 *           type: string
 *         engine_no:
 *           type: string
 *         chassis_no:
 *           type: string
 *         year:
 *           type: number
 *     JewelleryDetails:
 *       type: object
 *       properties:
 *         type:
 *           type: string
 *         description:
 *           type: string
 *         weight:
 *           type: number
 *         purity:
 *           type: string
 *         estimated_value:
 *           type: number
 *     AdminNote:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *         note:
 *           type: string
 *         created_by:
 *           type: object
 *           properties:
 *             _id:
 *               type: string
 *             first_name:
 *               type: string
 *             last_name:
 *               type: string
 *             email:
 *               type: string
 *         created_at:
 *           type: string
 *           format: date-time
 *     LoanApplication:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *         application_no:
 *           type: string
 *         customer_user:
 *           type: object
 *         requested_loan_amount:
 *           type: number
 *         interest_rate:
 *           type: number
 *         interest_amount:
 *           type: number
 *         total_repayable_amount:
 *           type: number
 *         collateral_category:
 *           type: string
 *           enum: [small_loans, motor_vehicle, jewellery]
 *         collateral_description:
 *           type: string
 *         surety_description:
 *           type: string
 *         declared_asset_value:
 *           type: number
 *         small_loan_details:
 *           $ref: '#/components/schemas/SmallLoanDetails'
 *         motor_vehicle_details:
 *           $ref: '#/components/schemas/MotorVehicleDetails'
 *         jewellery_details:
 *           $ref: '#/components/schemas/JewelleryDetails'
 *         collateral_images:
 *           type: array
 *           items:
 *             type: string
 *         repayment_type:
 *           type: string
 *           enum: [once_off, installment]
 *         repayment_days:
 *           type: number
 *         installment_count:
 *           type: number
 *         installment_frequency:
 *           type: string
 *           enum: [weekly, biweekly, monthly, quarterly]
 *         installment_amount:
 *           type: number
 *         status:
 *           type: string
 *           enum: [submitted, processing, approved, rejected, cancelled]
 *         admin_notes:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/AdminNote'
 *         created_at:
 *           type: string
 *           format: date-time
 *         updated_at:
 *           type: string
 *           format: date-time
 */

/**
 * @swagger
 * /api/v1/loan-applications:
 *   post:
 *     summary: Create a new loan application – for customers
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
 *               - requested_loan_amount
 *               - collateral_category
 *             properties:
 *               requested_loan_amount:
 *                 type: number
 *                 minimum: 0
 *                 description: Amount requested for the loan
 *               collateral_category:
 *                 type: string
 *                 enum: [small_loans, motor_vehicle, jewellery]
 *                 description: Type of collateral being offered
 *               collateral_description:
 *                 type: string
 *                 description: Description of the collateral
 *               surety_description:
 *                 type: string
 *                 description: Details of surety/guarantor if any
 *               declared_asset_value:
 *                 type: number
 *                 minimum: 0
 *                 description: Declared value of the collateral
 *               small_loan_details:
 *                 $ref: '#/components/schemas/SmallLoanDetails'
 *               motor_vehicle_details:
 *                 $ref: '#/components/schemas/MotorVehicleDetails'
 *               jewellery_details:
 *                 $ref: '#/components/schemas/JewelleryDetails'
 *               repayment_type:
 *                 type: string
 *                 enum: [once_off, installment]
 *                 default: once_off
 *               repayment_days:
 *                 type: number
 *                 minimum: 1
 *                 description: Expected days to repay (for once_off or total duration)
 *               installment_count:
 *                 type: number
 *                 minimum: 1
 *               installment_frequency:
 *                 type: string
 *                 enum: [weekly, biweekly, monthly, quarterly]
 *               installment_amount:
 *                 type: number
 *                 minimum: 0
 *               declaration_text:
 *                 type: string
 *               declaration_signed_at:
 *                 type: string
 *                 format: date-time
 *               declaration_signature_name:
 *                 type: string
 *               custom_terms_and_conditions:
 *                 type: string
 *     responses:
 *       201:
 *         description: Loan application created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/LoanApplication'
 *                 message:
 *                   type: string
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
  loanApplicationController.createLoanApplication,
);

/**
 * @swagger
 * /api/v1/loan-applications/admin/create:
 *   post:
 *     summary: Create a loan application for a specific customer (staff only)
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
 *               - customer_user_id
 *               - requested_loan_amount
 *               - collateral_category
 *             properties:
 *               customer_user_id:
 *                 type: string
 *                 description: ID of the customer from User model
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
 *               small_loan_details:
 *                 $ref: '#/components/schemas/SmallLoanDetails'
 *               motor_vehicle_details:
 *                 $ref: '#/components/schemas/MotorVehicleDetails'
 *               jewellery_details:
 *                 $ref: '#/components/schemas/JewelleryDetails'
 *               repayment_type:
 *                 type: string
 *                 enum: [once_off, installment]
 *                 default: once_off
 *               repayment_days:
 *                 type: number
 *                 minimum: 1
 *               installment_count:
 *                 type: number
 *                 minimum: 1
 *               installment_frequency:
 *                 type: string
 *                 enum: [weekly, biweekly, monthly, quarterly]
 *               installment_amount:
 *                 type: number
 *                 minimum: 0
 *               declaration_text:
 *                 type: string
 *               declaration_signed_at:
 *                 type: string
 *                 format: date-time
 *               declaration_signature_name:
 *                 type: string
 *               custom_terms_and_conditions:
 *                 type: string
 *     responses:
 *       201:
 *         description: Loan application created successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 *       500:
 *         description: Server error
 */
router.post(
  "/admin/create",
  authMiddleware,
  requireRoles(
    "loan_officer_approval",
    "super_admin_vendor",
    "admin_pawn_limited",
    "management",
    "loan_officer_processor",
    "agent",
  ),
  loanApplicationController.createLoanApplicationForCustomer,
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
 *           enum: [submitted, processing, approved, rejected, cancelled]
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
 *         description: Search by application number
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
    "customer",
  ),
  loanApplicationController.getLoanApplications,
);

/**
 * @swagger
 * /api/v1/loan-applications/agent/{agentId}:
 *   get:
 *     summary: Get loan applications created by a specific agent
 *     tags: [Loan Applications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: agentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Agent user ID
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           default: created_at
 *       - in: query
 *         name: sortOrder
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [submitted, processing, approved, rejected, cancelled]
 *       - in: query
 *         name: collateral_category
 *         schema:
 *           type: string
 *           enum: [small_loans, motor_vehicle, jewellery]
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: Applications retrieved successfully
 *       403:
 *         description: Not authorized
 *       500:
 *         description: Server error
 */
router.get(
  "/agent/:agentId",
  authMiddleware,
  requireRoles(
    "agent",
    "super_admin_vendor",
    "admin_pawn_limited",
    "management",
  ),
  loanApplicationController.getLoanApplicationsByAgentId,
);

/**
 * @swagger
 * /api/v1/loan-applications/processor/{processorId}:
 *   get:
 *     summary: Get loan applications processed by a specific loan processor
 *     tags: [Loan Applications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: processorId
 *         required: true
 *         schema:
 *           type: string
 *         description: Processor user ID
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           default: created_at
 *       - in: query
 *         name: sortOrder
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [submitted, processing, approved, rejected, cancelled]
 *       - in: query
 *         name: collateral_category
 *         schema:
 *           type: string
 *           enum: [small_loans, motor_vehicle, jewellery]
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: Applications retrieved successfully
 *       403:
 *         description: Not authorized
 *       500:
 *         description: Server error
 */
router.get(
  "/processor/:processorId",
  authMiddleware,
  requireRoles(
    "loan_officer_processor",
    "super_admin_vendor",
    "admin_pawn_limited",
    "management",
  ),
  loanApplicationController.getLoanApplicationsByProcessorId,
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
    "customer",
  ),
  loanApplicationController.getLoanApplicationById,
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
 *               requested_loan_amount:
 *                 type: number
 *               interest_rate:
 *                 type: number
 *               interest_amount:
 *                 type: number
 *               total_repayable_amount:
 *                 type: number
 *               collateral_description:
 *                 type: string
 *               surety_description:
 *                 type: string
 *               declared_asset_value:
 *                 type: number
 *               small_loan_details:
 *                 $ref: '#/components/schemas/SmallLoanDetails'
 *               motor_vehicle_details:
 *                 $ref: '#/components/schemas/MotorVehicleDetails'
 *               jewellery_details:
 *                 $ref: '#/components/schemas/JewelleryDetails'
 *               repayment_type:
 *                 type: string
 *                 enum: [once_off, installment]
 *               repayment_days:
 *                 type: number
 *               installment_count:
 *                 type: number
 *               installment_frequency:
 *                 type: string
 *                 enum: [weekly, biweekly, monthly, quarterly]
 *               installment_amount:
 *                 type: number
 *               declaration_text:
 *                 type: string
 *               declaration_signed_at:
 *                 type: string
 *                 format: date-time
 *               declaration_signature_name:
 *                 type: string
 *               custom_terms_and_conditions:
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
    "management",
  ),
  loanApplicationController.updateLoanApplication,
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
    "management",
  ),
  loanApplicationController.updateLoanApplicationStatus,
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
    "management",
  ),
  loanApplicationController.performDebtorCheck,
);

/**
 * @swagger
 * /api/v1/loan-applications/{id}/admin-notes:
 *   get:
 *     summary: Get all admin notes for a loan application
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
 *         description: Admin notes retrieved successfully
 *       400:
 *         description: Invalid application ID
 *       404:
 *         description: Loan application not found
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get(
  "/:id/admin-notes",
  authMiddleware,
  requireRoles(
    "loan_officer_processor",
    "loan_officer_approval",
    "super_admin_vendor",
    "admin_pawn_limited",
    "management",
  ),
  loanApplicationController.getAdminNotes,
);

/**
 * @swagger
 * /api/v1/loan-applications/{id}/admin-notes:
 *   post:
 *     summary: Add an admin note to a loan application
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
 *               - note
 *             properties:
 *               note:
 *                 type: string
 *                 description: Admin note text
 *     responses:
 *       201:
 *         description: Admin note added successfully
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
  "/:id/admin-notes",
  authMiddleware,
  requireRoles(
    "loan_officer_processor",
    "loan_officer_approval",
    "super_admin_vendor",
    "admin_pawn_limited",
    "management",
  ),
  loanApplicationController.addAdminNote,
);

/**
 * @swagger
 * /api/v1/loan-applications/{id}/admin-notes/{noteId}:
 *   put:
 *     summary: Update an admin note
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
 *         name: noteId
 *         required: true
 *         schema:
 *           type: string
 *         description: Admin note ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - note
 *             properties:
 *               note:
 *                 type: string
 *                 description: Updated admin note text
 *     responses:
 *       200:
 *         description: Admin note updated successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Not authorized to update this note
 *       404:
 *         description: Loan application or note not found
 *       500:
 *         description: Server error
 */
router.put(
  "/:id/admin-notes/:noteId",
  authMiddleware,
  requireRoles(
    "loan_officer_processor",
    "loan_officer_approval",
    "super_admin_vendor",
    "admin_pawn_limited",
    "management",
  ),
  loanApplicationController.updateAdminNote,
);

/**
 * @swagger
 * /api/v1/loan-applications/{id}/admin-notes/{noteId}:
 *   delete:
 *     summary: Delete an admin note
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
 *         name: noteId
 *         required: true
 *         schema:
 *           type: string
 *         description: Admin note ID
 *     responses:
 *       200:
 *         description: Admin note deleted successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Not authorized to delete this note
 *       404:
 *         description: Loan application or note not found
 *       500:
 *         description: Server error
 */
router.delete(
  "/:id/admin-notes/:noteId",
  authMiddleware,
  requireRoles(
    "loan_officer_processor",
    "loan_officer_approval",
    "super_admin_vendor",
    "admin_pawn_limited",
    "management",
  ),
  loanApplicationController.deleteAdminNote,
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
    "management",
  ),
  loanApplicationController.sendDocumentRequirement,
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
    "customer",
  ),
  loanApplicationController.getStatistics,
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
  },
);

/**
 * @swagger
 * /api/v1/loan-applications/{id}:
 *   delete:
 *     summary: Delete a loan application permanently (admin/loan officer only)
 *     tags: [Loan Applications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Loan application deleted successfully
 *       403:
 *         description: Not authorized
 *       404:
 *         description: Application not found
 */
router.delete(
  "/:id",
  authMiddleware,
  requireRoles(
    "super_admin_vendor",
    "admin_pawn_limited",
    "management",
    "loan_officer_processor",
    "loan_officer_approval",
  ),
  loanApplicationController.deleteLoanApplication,
);

module.exports = router;
