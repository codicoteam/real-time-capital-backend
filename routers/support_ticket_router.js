const express = require("express");
const router = express.Router();
const SupportTicketController = require("../controllers/support_ticket_controller");
const {
  authMiddleware,
  requireRoles,
} = require("../middlewares/auth_middleware");

// Apply authentication middleware to all routes
router.use(authMiddleware);

/**
 * @swagger
 * tags:
 *   name: Support Tickets
 *   description: Support ticket management endpoints
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     SupportTicket:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *         ticket_no:
 *           type: string
 *         created_by_user:
 *           $ref: '#/components/schemas/User'
 *         customer_user:
 *           $ref: '#/components/schemas/User'
 *         category:
 *           type: string
 *           enum: ["loan", "payment", "auction", "account", "technical", "general"]
 *         subject:
 *           type: string
 *         description:
 *           type: string
 *         status:
 *           type: string
 *           enum: ["open", "in_progress", "resolved", "closed"]
 *           default: "open"
 *         priority:
 *           type: string
 *           enum: ["low", "medium", "high", "urgent"]
 *           default: "medium"
 *         assigned_to:
 *           $ref: '#/components/schemas/User'
 *         attachments:
 *           type: array
 *           items:
 *             type: string
 *         meta:
 *           type: object
 *         created_at:
 *           type: string
 *           format: date-time
 *         updated_at:
 *           type: string
 *           format: date-time
 * 
 *     CreateTicketRequest:
 *       type: object
 *       required:
 *         - subject
 *       properties:
 *         subject:
 *           type: string
 *           minLength: 5
 *           maxLength: 200
 *         description:
 *           type: string
 *           minLength: 10
 *         category:
 *           type: string
 *           enum: ["loan", "payment", "auction", "account", "technical", "general"]
 *         priority:
 *           type: string
 *           enum: ["low", "medium", "high", "urgent"]
 *           default: "medium"
 *         customer_user:
 *           type: string
 *           description: Required if creating ticket for another customer
 *         meta:
 *           type: object
 * 
 *     UpdateTicketRequest:
 *       type: object
 *       properties:
 *         subject:
 *           type: string
 *           minLength: 5
 *           maxLength: 200
 *         description:
 *           type: string
 *           minLength: 10
 *         category:
 *           type: string
 *           enum: ["loan", "payment", "auction", "account", "technical", "general"]
 *         priority:
 *           type: string
 *           enum: ["low", "medium", "high", "urgent"]
 * 
 *     UpdateStatusRequest:
 *       type: object
 *       required:
 *         - status
 *       properties:
 *         status:
 *           type: string
 *           enum: ["open", "in_progress", "resolved", "closed", "reopened"]
 * 
 *     AssignTicketRequest:
 *       type: object
 *       required:
 *         - assignee_id
 *       properties:
 *         assignee_id:
 *           type: string
 *           description: Staff user ID to assign the ticket to
 * 
 *     AddAttachmentRequest:
 *       type: object
 *       required:
 *         - attachment_id
 *       properties:
 *         attachment_id:
 *           type: string
 *           description: Attachment document ID
 */

/**
 * @swagger
 * /api/v1/support-tickets:
 *   post:
 *     summary: Create a new support ticket
 *     tags: [Support Tickets]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateTicketRequest'
 *     responses:
 *       201:
 *         description: Ticket created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/SupportTicket'
 *                 message:
 *                   type: string
 *       400:
 *         description: Invalid input data
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 */
router.post(
  "/",
  SupportTicketController.createTicket
);

/**
 * @swagger
 * /api/v1/support-tickets:
 *   get:
 *     summary: Get tickets with pagination and filters
 *     tags: [Support Tickets]
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
 *           default: 10
 *         description: Items per page
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: ["open", "in_progress", "resolved", "closed"]
 *         description: Filter by status
 *       - in: query
 *         name: priority
 *         schema:
 *           type: string
 *           enum: ["low", "medium", "high", "urgent"]
 *         description: Filter by priority
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *           enum: ["loan", "payment", "auction", "account", "technical", "general"]
 *         description: Filter by category
 *       - in: query
 *         name: customer_user
 *         schema:
 *           type: string
 *         description: Filter by customer user ID
 *       - in: query
 *         name: assigned_to
 *         schema:
 *           type: string
 *         description: Filter by assigned staff ID
 *       - in: query
 *         name: created_from
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter by creation date from
 *       - in: query
 *         name: created_to
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter by creation date to
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search in ticket_no, subject, description
 *       - in: query
 *         name: sort_by
 *         schema:
 *           type: string
 *           default: created_at
 *           enum: [created_at, updated_at, priority, status]
 *         description: Field to sort by
 *       - in: query
 *         name: sort_order
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *         description: Sort order
 *     responses:
 *       200:
 *         description: Tickets retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     tickets:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/SupportTicket'
 *                     pagination:
 *                       type: object
 *                       properties:
 *                         page:
 *                           type: integer
 *                         limit:
 *                           type: integer
 *                         total:
 *                           type: integer
 *                         pages:
 *                           type: integer
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/",
  SupportTicketController.getTickets
);

/**
 * @swagger
 * /api/v1/support-tickets/{id}:
 *   get:
 *     summary: Get ticket by ID
 *     tags: [Support Tickets]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Ticket ID
 *     responses:
 *       200:
 *         description: Ticket details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/SupportTicket'
 *       404:
 *         description: Ticket not found
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Access denied to this ticket
 */
router.get(
  "/:id",
  SupportTicketController.getTicket
);

/**
 * @swagger
 * /api/v1/support-tickets/{id}:
 *   put:
 *     summary: Update ticket
 *     tags: [Support Tickets]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Ticket ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateTicketRequest'
 *     responses:
 *       200:
 *         description: Ticket updated successfully
 *       400:
 *         description: Invalid input data
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 *       404:
 *         description: Ticket not found
 */
router.put(
  "/:id",
  SupportTicketController.updateTicket
);

/**
 * @swagger
 * /api/v1/support-tickets/{id}/status:
 *   put:
 *     summary: Update ticket status
 *     tags: [Support Tickets]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Ticket ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateStatusRequest'
 *     responses:
 *       200:
 *         description: Status updated successfully
 *       400:
 *         description: Invalid status or status transition
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 *       404:
 *         description: Ticket not found
 */
router.put(
  "/:id/status",
  SupportTicketController.updateTicketStatus
);

/**
 * @swagger
 * /api/v1/support-tickets/{id}/assign:
 *   put:
 *     summary: Assign ticket to staff
 *     tags: [Support Tickets]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Ticket ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AssignTicketRequest'
 *     responses:
 *       200:
 *         description: Ticket assigned successfully
 *       400:
 *         description: Invalid assignee or ticket not found
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions (staff only)
 *       404:
 *         description: Ticket not found
 */
router.put(
  "/:id/assign",
  requireRoles(
    "loan_officer_processor",
    "loan_officer_approval",
    "admin_pawn_limited",
    "management",
    "super_admin_vendor"
  ),
  SupportTicketController.assignTicket
);

/**
 * @swagger
 * /api/v1/support-tickets/{id}/attachments:
 *   post:
 *     summary: Add attachment to ticket
 *     tags: [Support Tickets]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Ticket ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AddAttachmentRequest'
 *     responses:
 *       200:
 *         description: Attachment added successfully
 *       400:
 *         description: Invalid input data
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 *       404:
 *         description: Ticket not found
 */
router.post(
  "/:id/attachments",
  SupportTicketController.addAttachment
);

/**
 * @swagger
 * /api/v1/support-tickets/stats:
 *   get:
 *     summary: Get ticket statistics
 *     tags: [Support Tickets]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Ticket statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: integer
 *                     open:
 *                       type: integer
 *                     in_progress:
 *                       type: integer
 *                     resolved:
 *                       type: integer
 *                     closed:
 *                       type: integer
 *                     priority:
 *                       type: object
 *                       properties:
 *                         urgent:
 *                           type: integer
 *                         high:
 *                           type: integer
 *                         medium:
 *                           type: integer
 *                         low:
 *                           type: integer
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/stats",
  SupportTicketController.getTicketStats
);

/**
 * @swagger
 * /api/v1/support-tickets/customer/{customerId}:
 *   get:
 *     summary: Get tickets by customer
 *     tags: [Support Tickets]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: customerId
 *         required: true
 *         schema:
 *           type: string
 *         description: Customer user ID
 *     responses:
 *       200:
 *         description: Customer's tickets retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Access denied to view other customer's tickets
 *       404:
 *         description: Customer not found
 */
router.get(
  "/customer/:customerId",
  SupportTicketController.getTicketsByCustomer
);

/**
 * @swagger
 * /api/v1/support-tickets/assigned/my:
 *   get:
 *     summary: Get tickets assigned to me (staff only)
 *     tags: [Support Tickets]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: ["open", "in_progress", "resolved", "closed"]
 *         description: Filter by status
 *       - in: query
 *         name: priority
 *         schema:
 *           type: string
 *           enum: ["low", "medium", "high", "urgent"]
 *         description: Filter by priority
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *           enum: ["loan", "payment", "auction", "account", "technical", "general"]
 *         description: Filter by category
 *     responses:
 *       200:
 *         description: Assigned tickets retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Staff only endpoint
 */
router.get(
  "/assigned/my",
  requireRoles(
    "loan_officer_processor",
    "loan_officer_approval",
    "admin_pawn_limited",
    "management",
    "super_admin_vendor"
  ),
  SupportTicketController.getMyAssignedTickets
);

/**
 * @swagger
 * /api/v1/support-tickets/search:
 *   get:
 *     summary: Search tickets
 *     tags: [Support Tickets]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *         description: Search term (minimum 2 characters)
 *     responses:
 *       200:
 *         description: Search results
 *       400:
 *         description: Search term too short
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/search",
  SupportTicketController.searchTickets
);

module.exports = router;