const express = require("express");
const router = express.Router();
const signedDocumentController = require("../controllers/signed_document_controller");
const { authMiddleware, requireRoles } = require("../middlewares/auth_middleware");

/**
 * @swagger
 * tags:
 *   name: Signed Documents
 *   description: Document generation, signature stamping, and management for loan applications
 */

/**
 * @swagger
 * /api/v1/signed-documents/generate/{applicationId}:
 *   post:
 *     summary: Generate a PDF document from template for a loan application
 *     tags: [Signed Documents]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: applicationId
 *         required: true
 *         schema:
 *           type: string
 *         description: Loan application ID
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               templateCode:
 *                 type: string
 *                 enum: [LOAN_REQUEST_FORM, PAWN_CONTRACT_MOTOR_VEHICLE, PAWN_CONTRACT_OTHER_MOVABLES]
 *                 default: LOAN_REQUEST_FORM
 *                 description: Template type to use for document generation
 *           example:
 *             templateCode: LOAN_REQUEST_FORM
 *     responses:
 *       201:
 *         description: Document generated successfully with base64 PDF
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
 *                     signedDocumentId:
 *                       type: string
 *                       description: ID of the created signed document record
 *                     filename:
 *                       type: string
 *                     base64:
 *                       type: string
 *                       description: Base64 encoded PDF content
 *                     mimeType:
 *                       type: string
 *                       example: application/pdf
 *                 message:
 *                   type: string
 *       400:
 *         description: Validation error or template not found
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Loan application not found
 */
router.post(
  "/generate/:applicationId",
  authMiddleware,
  signedDocumentController.generateDocument
);

/**
 * @swagger
 * /api/v1/signed-documents/{documentId}/sign:
 *   post:
 *     summary: Upload signature image and stamp it on PDF document
 *     description: Send signature as base64 encoded image. Returns signed PDF as base64. Document status becomes "verified" after signing.
 *     tags: [Signed Documents]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: documentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Signed document ID to sign
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - signatureBase64
 *               - signedByName
 *             properties:
 *               signatureBase64:
 *                 type: string
 *                 description: Base64 encoded signature image (PNG or JPG). Example format - data without "data:image/png;base64," prefix
 *                 example: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
 *               signedByName:
 *                 type: string
 *                 description: Full name of the person signing
 *                 example: John Doe
 *           example:
 *             signatureBase64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
 *             signedByName: "John Doe"
 *     responses:
 *       200:
 *         description: Signature stamped successfully. Document signed and returns updated base64 PDF.
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
 *                     signedDocumentId:
 *                       type: string
 *                     filename:
 *                       type: string
 *                     base64:
 *                       type: string
 *                       description: Updated base64 encoded PDF with signature stamped
 *                     mimeType:
 *                       type: string
 *                       example: application/pdf
 *                     signedAt:
 *                       type: string
 *                       format: date-time
 *                     signedBy:
 *                       type: string
 *                 message:
 *                   type: string
 *       400:
 *         description: Missing required fields or invalid document
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Document not found
 */
router.post(
  "/:documentId/sign",
  authMiddleware,
  signedDocumentController.signDocument
);

/**
 * @swagger
 * /api/v1/signed-documents/{documentId}:
 *   get:
 *     summary: Retrieve a signed document by ID
 *     description: Returns the document with base64 encoded PDF content
 *     tags: [Signed Documents]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: documentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Signed document ID
 *     responses:
 *       200:
 *         description: Document retrieved successfully
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
 *                     _id:
 *                       type: string
 *                     template_id:
 *                       type: object
 *                       properties:
 *                         code:
 *                           type: string
 *                         title:
 *                           type: string
 *                         version:
 *                           type: string
 *                     applicant_user_id:
 *                       type: object
 *                       properties:
 *                         first_name:
 *                           type: string
 *                         last_name:
 *                           type: string
 *                         email:
 *                           type: string
 *                     loan_application_id:
 *                       type: object
 *                       properties:
 *                         application_no:
 *                           type: string
 *                         requested_loan_amount:
 *                           type: number
 *                         status:
 *                           type: string
 *                     base64:
 *                       type: string
 *                       description: Base64 encoded PDF content
 *                     mimeType:
 *                       type: string
 *                     status:
 *                       type: string
 *                       enum: [uploaded, verified, rejected]
 *                     signed_by_name:
 *                       type: string
 *                     signed_at:
 *                       type: string
 *                       format: date-time
 *                 message:
 *                   type: string
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Document not found
 *       500:
 *         description: Server error
 */
router.get("/:documentId", authMiddleware, signedDocumentController.getSignedDocument);

/**
 * @swagger
 * /api/v1/signed-documents/application/{applicationId}:
 *   get:
 *     summary: Get all signed documents for a loan application
 *     tags: [Signed Documents]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: applicationId
 *         required: true
 *         schema:
 *           type: string
 *         description: Loan application ID
 *     responses:
 *       200:
 *         description: Documents retrieved successfully
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
 *                     properties:
 *                       _id:
 *                         type: string
 *                       template_id:
 *                         type: object
 *                       loan_application_id:
 *                         type: string
 *                       status:
 *                         type: string
 *                       signed_at:
 *                         type: string
 *                         format: date-time
 *                       created_at:
 *                         type: string
 *                         format: date-time
 *                 message:
 *                   type: string
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get(
  "/application/:applicationId",
  authMiddleware,
  signedDocumentController.getApplicationDocuments
);

/**
 * @swagger
 * /api/v1/signed-documents/{documentId}:
 *   delete:
 *     summary: Delete a signed document
 *     tags: [Signed Documents]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: documentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Signed document ID
 *     responses:
 *       200:
 *         description: Document deleted successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Document not found
 */
router.delete("/:documentId", authMiddleware, signedDocumentController.deleteSignedDocument);

module.exports = router;
