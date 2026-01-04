const express = require('express');
const router = express.Router();
const attachmentController = require('../controllers/attachment_controller');
const { authMiddleware, requireRoles } = require('../middlewares/auth_middleware');

/**
 * @swagger
 * tags:
 *   name: Attachments
 *   description: Attachment management for pawn system
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
 * /api/v1/attachments/upload:
 *   post:
 *     summary: Upload a new attachment
 *     tags: [Attachments]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - entity_type
 *               - entity_id
 *               - category
 *               - storage
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: File to upload (required if storage is not 'url')
 *               entity_type:
 *                 type: string
 *                 enum: [LoanApplication, Loan, Asset, User, Ticket, DebtorRecord, Other]
 *                 description: Type of entity this attachment belongs to
 *               entity_id:
 *                 type: string
 *                 description: ID of the entity
 *               category:
 *                 type: string
 *                 enum: [national_id, loan_request_form, pawn_ticket, contract, proof_of_residence, asset_photos, other]
 *                 default: other
 *               storage:
 *                 type: string
 *                 enum: [gridfs, s3, local, url]
 *                 default: url
 *               url:
 *                 type: string
 *                 description: Required if storage is 'url'
 *               filename:
 *                 type: string
 *                 description: Original filename (auto-filled if file is provided)
 *               mime_type:
 *                 type: string
 *                 description: MIME type (auto-filled if file is provided)
 *               signed:
 *                 type: boolean
 *                 default: false
 *               meta:
 *                 type: object
 *                 description: Additional metadata
 *     responses:
 *       201:
 *         description: Attachment uploaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                 message:
 *                   type: string
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.post(
  '/upload',
  authMiddleware,
  requireRoles(
    'super_admin_vendor',
    'admin_pawn_limited',
    'loan_officer_processor',
    'loan_officer_approval',
    'management',
    'customer'
  ),
  attachmentController.uploadAttachment
);

/**
 * @swagger
 * /api/v1/attachments:
 *   get:
 *     summary: Get all attachments with pagination
 *     tags: [Attachments]
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
 *         name: entity_type
 *         schema:
 *           type: string
 *         description: Filter by entity type
 *       - in: query
 *         name: entity_id
 *         schema:
 *           type: string
 *         description: Filter by entity ID
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *         description: Filter by category
 *       - in: query
 *         name: owner_user
 *         schema:
 *           type: string
 *         description: Filter by owner user ID
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search in filename or mime_type
 *       - in: query
 *         name: signed
 *         schema:
 *           type: string
 *           enum: [true, false]
 *         description: Filter by signed status
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter attachments created after this date
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter attachments created before this date
 *     responses:
 *       200:
 *         description: Attachments retrieved successfully
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
 *                     attachments:
 *                       type: array
 *                       items:
 *                         type: object
 *                     pagination:
 *                       type: object
 *                 message:
 *                   type: string
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get(
  '/',
  authMiddleware,
  requireRoles(
    'super_admin_vendor',
    'admin_pawn_limited',
    'loan_officer_processor',
    'loan_officer_approval',
    'management'
  ),
  attachmentController.getAllAttachments
);

/**
 * @swagger
 * /api/v1/attachments/list:
 *   get:
 *     summary: Get attachments without pagination
 *     tags: [Attachments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: entity_type
 *         schema:
 *           type: string
 *         description: Filter by entity type
 *       - in: query
 *         name: entity_id
 *         schema:
 *           type: string
 *         description: Filter by entity ID
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *         description: Filter by category
 *       - in: query
 *         name: owner_user
 *         schema:
 *           type: string
 *         description: Filter by owner user ID
 *       - in: query
 *         name: signed
 *         schema:
 *           type: string
 *           enum: [true, false]
 *         description: Filter by signed status
 *     responses:
 *       200:
 *         description: Attachments retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                 message:
 *                   type: string
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get(
  '/list',
  authMiddleware,
  requireRoles(
    'super_admin_vendor',
    'admin_pawn_limited',
    'loan_officer_processor',
    'loan_officer_approval',
    'management',
    'customer'
  ),
  attachmentController.getAttachmentsWithoutPagination
);

/**
 * @swagger
 * /api/v1/attachments/{id}:
 *   get:
 *     summary: Get a single attachment by ID
 *     tags: [Attachments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Attachment ID
 *     responses:
 *       200:
 *         description: Attachment retrieved successfully
 *       400:
 *         description: Invalid ID format
 *       404:
 *         description: Attachment not found
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get(
  '/:id',
  authMiddleware,
  requireRoles(
    'super_admin_vendor',
    'admin_pawn_limited',
    'loan_officer_processor',
    'loan_officer_approval',
    'management',
    'customer'
  ),
  attachmentController.getAttachmentById
);

/**
 * @swagger
 * /api/v1/attachments/{id}:
 *   put:
 *     summary: Update an attachment
 *     tags: [Attachments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Attachment ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               category:
 *                 type: string
 *                 enum: [national_id, loan_request_form, pawn_ticket, contract, proof_of_residence, asset_photos, other]
 *               filename:
 *                 type: string
 *               signed:
 *                 type: boolean
 *               meta:
 *                 type: object
 *     responses:
 *       200:
 *         description: Attachment updated successfully
 *       400:
 *         description: Bad request
 *       404:
 *         description: Attachment not found
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.put(
  '/:id',
  authMiddleware,
  requireRoles(
    'super_admin_vendor',
    'admin_pawn_limited',
    'loan_officer_processor',
    'loan_officer_approval',
    'management'
  ),
  attachmentController.updateAttachment
);

/**
 * @swagger
 * /api/v1/attachments/{id}:
 *   delete:
 *     summary: Delete an attachment
 *     tags: [Attachments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Attachment ID
 *     responses:
 *       200:
 *         description: Attachment deleted successfully
 *       400:
 *         description: Invalid ID format
 *       404:
 *         description: Attachment not found
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.delete(
  '/:id',
  authMiddleware,
  requireRoles('super_admin_vendor', 'admin_pawn_limited'),
  attachmentController.deleteAttachment
);

/**
 * @swagger
 * /api/v1/attachments/entity/{entityType}/{entityId}:
 *   get:
 *     summary: Get attachments by entity
 *     tags: [Attachments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: entityType
 *         required: true
 *         schema:
 *           type: string
 *         description: Entity type
 *       - in: path
 *         name: entityId
 *         required: true
 *         schema:
 *           type: string
 *         description: Entity ID
 *     responses:
 *       200:
 *         description: Attachments retrieved successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get(
  '/entity/:entityType/:entityId',
  authMiddleware,
  requireRoles(
    'super_admin_vendor',
    'admin_pawn_limited',
    'loan_officer_processor',
    'loan_officer_approval',
    'management',
    'customer'
  ),
  attachmentController.getAttachmentsByEntity
);

/**
 * @swagger
 * /api/v1/attachments/user/{userId}:
 *   get:
 *     summary: Get attachments by user
 *     tags: [Attachments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID
 *     responses:
 *       200:
 *         description: Attachments retrieved successfully
 *       400:
 *         description: Invalid user ID
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get(
  '/user/:userId',
  authMiddleware,
  requireRoles(
    'super_admin_vendor',
    'admin_pawn_limited',
    'loan_officer_processor',
    'loan_officer_approval',
    'management'
  ),
  attachmentController.getAttachmentsByUser
);

/**
 * @swagger
 * /api/v1/attachments/{id}/sign:
 *   post:
 *     summary: Sign an attachment
 *     tags: [Attachments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Attachment ID
 *     responses:
 *       200:
 *         description: Attachment signed successfully
 *       400:
 *         description: Bad request
 *       404:
 *         description: Attachment not found
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.post(
  '/:id/sign',
  authMiddleware,
  requireRoles(
    'super_admin_vendor',
    'admin_pawn_limited',
    'loan_officer_approval',
    'management'
  ),
  attachmentController.signAttachment
);

/**
 * @swagger
 * /api/v1/attachments/{id}/download:
 *   get:
 *     summary: Download an attachment
 *     tags: [Attachments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Attachment ID
 *     responses:
 *       200:
 *         description: File downloaded successfully
 *         content:
 *           application/octet-stream:
 *             schema:
 *               type: string
 *               format: binary
 *       404:
 *         description: Attachment not found or file not available
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get(
  '/:id/download',
  authMiddleware,
  requireRoles(
    'super_admin_vendor',
    'admin_pawn_limited',
    'loan_officer_processor',
    'loan_officer_approval',
    'management',
    'customer'
  ),
  attachmentController.downloadAttachment
);

/**
 * @swagger
 * /api/v1/attachments/stats:
 *   get:
 *     summary: Get attachment statistics
 *     tags: [Attachments]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Statistics retrieved successfully
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
 *                     byEntityType:
 *                       type: array
 *                     byCategory:
 *                       type: array
 *                     totals:
 *                       type: object
 *                 message:
 *                   type: string
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get(
  '/stats',
  authMiddleware,
  requireRoles('super_admin_vendor', 'admin_pawn_limited', 'management'),
  attachmentController.getStatistics
);

module.exports = router;