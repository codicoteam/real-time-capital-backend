const express = require("express");
const router = express.Router();
const signedDocumentController = require("../controllers/signed_document_controller");
const { authMiddleware, requireRoles } = require("../middlewares/auth_middleware");
const multer = require("multer");
const path = require("path");

// Configure multer for signature uploads (images and PDFs)
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    // Allow images and PDFs for signatures
    const allowedImageTypes = /jpeg|jpg|png|gif/;
    const allowedPdfType = /pdf/;
    const extname = allowedImageTypes.test(path.extname(file.originalname).toLowerCase()) || 
                    allowedPdfType.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedImageTypes.test(file.mimetype) || allowedPdfType.test(file.mimetype);
    if (extname && mimetype) {
      return cb(null, true);
    }
    cb(new Error("Only image files (JPEG, JPG, PNG, GIF) and PDF files are allowed for signature"));
  }
});

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

// IMPORTANT: Route order matters! More specific routes must come before parameterized routes
// 1. First: /generate/:applicationId (already defined at top)
// 2. Second: /:documentId/sign (specific action on document) - must come before /:documentId
// 3. Third: /application/:applicationId - must come before /:documentId
// 4. Fourth: /:documentId (generic document operations - GET, DELETE)

/**
 * @swagger
 * /api/v1/signed-documents/{documentId}/sign:
 *   post:
 *     summary: Upload signature and stamp it on PDF document
 *     description: |
 *       Send signature as multipart form data (file upload) or as base64 encoded string. 
 *       Returns signed PDF as base64. Document status becomes "verified" after signing.
 *       
 *       **Two ways to send request:**
 *       
 *       1. **Multipart Form Data (Recommended)** - Upload signature file:
 *          - Field `signature`: The signature file (image: PNG, JPG, JPEG, GIF or PDF)
 *          - Field `signedByName`: Name of the person signing
 *       
 *       2. **JSON Body** - Send base64 encoded signature:
 *          - Field `signatureBase64`: Base64 encoded signature image
 *          - Field `signedByName`: Name of the person signing
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
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - signature
 *               - signedByName
 *             properties:
 *               signature:
 *                 type: string
 *                 format: binary
 *                 description: Signature file (PNG, JPG, JPEG, GIF, or PDF)
 *               signedByName:
 *                 type: string
 *                 description: Full name of the person signing
 *                 example: John Doe
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - signatureBase64
 *               - signedByName
 *             properties:
 *               signatureBase64:
 *                 type: string
 *                 description: Base64 encoded signature image (PNG, JPG) or PDF
 *                 example: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
 *               signedByName:
 *                 type: string
 *                 description: Full name of the person signing
 *                 example: John Doe
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
  upload.single("signature"),
  signedDocumentController.signDocument
);

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
