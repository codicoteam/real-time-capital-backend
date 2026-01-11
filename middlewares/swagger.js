const swaggerJsdoc = require("swagger-jsdoc");
const swaggerUi = require("swagger-ui-express");
// 
const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Real Time Pawn System API",
      version: "1.0.0",
      description:
        "API for managing a real-time pawn and collateral-based lending system, including user and role management, asset submission and valuation, loan applications, approvals, renewals, repayments, inventory tracking, auctions, bidding, financial ledger entries, profit and loss reporting, and document generation and signing, with full audit trail and role-based access control.",
    },
    servers: [
      {
        url: "http://13.61.185.238:7070",
        description: "AWS Short term server",
      },
      {
        url: "https://real-time-capital-backend.onrender.com",
        description: "Render server",
      },
      {
        url: "http://localhost:5050",
        description: "Local server",
      },
    ],
    components: {
      schemas: {
        // Schema definitions for reuse in API documentation
        // ---------- USER SUB-SCHEMAS ----------
        AuthProvider: {
          type: "object",
          additionalProperties: false,
          properties: {
            provider: {
              type: "string",
              enum: ["google", "apple", "email"],
              example: "email",
            },
            provider_user_id: {
              type: "string",
              example: "google-oauth2|1234567890",
            },
            added_at: {
              type: "string",
              format: "date-time",
              example: "2026-01-01T10:00:00.000Z",
            },
          },
          required: ["provider", "provider_user_id"],
        },

        UserDocument: {
          type: "object",
          additionalProperties: false,
          properties: {
            type: {
              type: "string",
              enum: ["national_id", "passport", "proof_of_address", "other"],
              example: "national_id",
            },
            url: {
              type: "string",
              format: "uri",
              example: "https://cdn.example.com/uploads/national-id-front.jpg",
            },
            file_name: {
              type: "string",
              example: "national-id-front.jpg",
            },
            mime_type: {
              type: "string",
              example: "image/jpeg",
            },
            uploaded_at: {
              type: "string",
              format: "date-time",
              example: "2026-01-01T10:00:00.000Z",
            },
            notes: {
              type: "string",
              example: "Front side of national ID",
            },
          },
          required: ["type", "url"],
        },

        // ---------- USER ----------
        User: {
          type: "object",
          additionalProperties: false,
          properties: {
            _id: {
              type: "string",
              example: "6592b8f0c0d3e7a3d9c2a111",
            },

            email: {
              type: "string",
              format: "email",
              example: "user@example.com",
            },
            phone: {
              type: "string",
              nullable: true,
              example: "+263771234567",
            },

            // NOTE: password_hash is select:false in mongoose, so typically you
            // do NOT expose it in API responses. Keep it only if you need it in a request schema.
            password_hash: {
              type: "string",
              nullable: true,
              example:
                "$2b$10$xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            },

            roles: {
              type: "array",
              items: {
                type: "string",
                enum: [
                  "super_admin_vendor",
                  "admin_pawn_limited",
                  "call_centre_support",
                  "loan_officer_processor",
                  "loan_officer_approval",
                  "management",
                  "customer",
                ],
              },
              example: ["customer"],
              minItems: 1,
            },

            first_name: {
              type: "string",
              example: "Prince",
            },
            last_name: {
              type: "string",
              example: "Makaza",
            },
            full_name: {
              type: "string",
              nullable: true,
              example: "Prince Makaza",
            },

            status: {
              type: "string",
              enum: ["pending", "active", "suspended", "deleted"],
              example: "pending",
            },

            national_id_number: {
              type: "string",
              nullable: true,
              example: "63-1234567-A-12",
            },
            date_of_birth: {
              type: "string",
              format: "date",
              nullable: true,
              example: "1995-06-14",
            },
            address: {
              type: "string",
              nullable: true,
              example: "123 Samora Machel Ave",
            },
            location: {
              type: "string",
              nullable: true,
              example: "Harare",
            },
            terms_accepted_at: {
              type: "string",
              format: "date-time",
              nullable: true,
              example: "2026-01-01T10:00:00.000Z",
            },

            national_id_image_url: {
              type: "string",
              format: "uri",
              nullable: true,
              example: "https://cdn.example.com/uploads/national-id.jpg",
            },
            profile_pic_url: {
              type: "string",
              format: "uri",
              nullable: true,
              example: "https://cdn.example.com/uploads/profile.jpg",
            },

            documents: {
              type: "array",
              items: { $ref: "#/components/schemas/UserDocument" },
              example: [
                {
                  type: "passport",
                  url: "https://cdn.example.com/uploads/passport.pdf",
                  file_name: "passport.pdf",
                  mime_type: "application/pdf",
                  uploaded_at: "2026-01-01T10:00:00.000Z",
                  notes: "Scanned copy",
                },
              ],
            },

            email_verified: {
              type: "boolean",
              example: false,
            },
            email_verification_otp: {
              type: "string",
              nullable: true,
              example: "123456",
            },
            email_verification_expires_at: {
              type: "string",
              format: "date-time",
              nullable: true,
              example: "2026-01-01T10:10:00.000Z",
            },

            delete_account_otp: {
              type: "string",
              nullable: true,
              example: "654321",
            },
            delete_account_otp_expires_at: {
              type: "string",
              format: "date-time",
              nullable: true,
              example: "2026-01-01T10:10:00.000Z",
            },

            reset_password_otp: {
              type: "string",
              nullable: true,
              example: "987654",
            },
            reset_password_expires_at: {
              type: "string",
              format: "date-time",
              nullable: true,
              example: "2026-01-01T10:10:00.000Z",
            },

            auth_providers: {
              type: "array",
              items: { $ref: "#/components/schemas/AuthProvider" },
              example: [
                {
                  provider: "google",
                  provider_user_id: "google-oauth2|1234567890",
                  added_at: "2026-01-01T10:00:00.000Z",
                },
              ],
            },

            created_at: {
              type: "string",
              format: "date-time",
              example: "2026-01-01T10:00:00.000Z",
            },
            updated_at: {
              type: "string",
              format: "date-time",
              example: "2026-01-01T10:00:00.000Z",
            },
          },

          // Required in mongoose:
          required: ["email", "first_name", "last_name"],
        },
        AssetValuationCreditCheck: {
          type: "object",
          additionalProperties: false,
          properties: {
            provider: {
              type: "string",
              example: "FCB",
              description: "Credit bureau or provider name",
            },
            reference: {
              type: "string",
              example: "FCB-REF-2026-0001",
            },
            score: {
              type: "number",
              example: 720,
            },
            checked_at: {
              type: "string",
              format: "date-time",
              example: "2026-01-01T10:00:00.000Z",
            },
          },
        },

        AssetValuation: {
          type: "object",
          additionalProperties: false,
          properties: {
            _id: {
              type: "string",
              example: "6592c9c1b2e7f5a2d8f31111",
            },

            asset: {
              type: "string",
              example: "6592b8f0c0d3e7a3d9c2a222",
              description: "Referenced Asset ID being evaluated",
            },

            stage: {
              type: "string",
              enum: ["market", "final"],
              example: "market",
              description: "Two-stage valuation process as per BRS",
            },

            status: {
              type: "string",
              enum: ["requested", "in_progress", "completed", "rejected"],
              example: "requested",
            },

            requested_by: {
              type: "string",
              nullable: true,
              example: "6592b8f0c0d3e7a3d9c2a333",
              description: "User who requested the valuation",
            },

            requested_at: {
              type: "string",
              format: "date-time",
              example: "2026-01-01T09:30:00.000Z",
            },

            valued_by_user: {
              type: "string",
              nullable: true,
              example: "6592b8f0c0d3e7a3d9c2a444",
              description: "Evaluator / loan officer assigned",
            },

            assessment_date: {
              type: "string",
              format: "date",
              nullable: true,
              example: "2026-01-02",
              description: "Date the valuation was performed (BRS requirement)",
            },

            method: {
              type: "string",
              enum: ["manual", "market_trend", "hybrid"],
              example: "manual",
            },

            estimated_market_value: {
              type: "number",
              minimum: 0,
              nullable: true,
              example: 1500,
              description: "Estimated fair market value of the asset",
            },

            estimated_loan_value: {
              type: "number",
              minimum: 0,
              nullable: true,
              example: 750,
              description: "System-calculated loan estimate (30% / 50% rule)",
            },

            final_value: {
              type: "number",
              minimum: 0,
              nullable: true,
              example: 800,
              description:
                "Final approved valuation (required for FINAL stage)",
            },

            desired_loan_amount: {
              type: "number",
              minimum: 0,
              nullable: true,
              example: 700,
              description:
                "Customer requested loan amount (required in FINAL stage)",
            },

            comments: {
              type: "string",
              nullable: true,
              example: "Asset condition verified and market demand is stable.",
            },

            currency: {
              type: "string",
              enum: ["USD", "ZWG"],
              example: "USD",
            },

            credit_check: {
              $ref: "#/components/schemas/AssetValuationCreditCheck",
            },

            attachments: {
              type: "array",
              items: {
                type: "string",
                example: "6592b8f0c0d3e7a3d9c2a555",
              },
              description: "Referenced Attachment IDs (reports, photos, PDFs)",
            },

            meta: {
              type: "object",
              nullable: true,
              example: {
                source: "manual_override",
                notes: "Exceptional item due to antique value",
              },
              description: "Flexible metadata for audit and system extensions",
            },

            created_at: {
              type: "string",
              format: "date-time",
              example: "2026-01-01T09:30:00.000Z",
            },

            updated_at: {
              type: "string",
              format: "date-time",
              example: "2026-01-01T11:00:00.000Z",
            },
          },

          required: ["asset", "stage"],
        },
        Asset: {
          type: "object",
          additionalProperties: false,

          properties: {
            _id: { type: "string", example: "6592b8f0c0d3e7a3d9c2a777" },

            asset_no: {
              type: "string",
              nullable: true,
              example: "AST-0000123",
              description: "Unique asset tracking number",
            },

            owner_user: {
              type: "string",
              nullable: true,
              example: "6592b8f0c0d3e7a3d9c2a111",
              description: "Customer User ID who owns the asset",
            },

            submitted_by: {
              type: "string",
              nullable: true,
              example: "6592b8f0c0d3e7a3d9c2a222",
              description: "User ID of staff/customer who submitted the asset",
            },

            category: {
              type: "string",
              enum: ["electronics", "vehicle", "jewellery"],
              example: "electronics",
            },

            title: { type: "string", example: "Dell Laptop" },
            description: {
              type: "string",
              nullable: true,
              example: "Core i7, 16GB RAM, 512GB SSD",
            },

            condition: { type: "string", nullable: true, example: "good" },

            status: {
              type: "string",
              enum: [
                "submitted",
                "valuating",
                "pawned",
                "active",
                "overdue",
                "in_repair",
                "auction",
                "sold",
                "redeemed",
                "closed",
              ],
              example: "submitted",
            },

            storage_location: {
              type: "string",
              nullable: true,
              example: "Vault A - Shelf 3",
            },

            declared_value: {
              type: "number",
              minimum: 0,
              nullable: true,
              example: 1500,
            },
            evaluated_value: {
              type: "number",
              minimum: 0,
              nullable: true,
              example: 1200,
            },
            valuation_notes: {
              type: "string",
              nullable: true,
              example: "Minor scratches; fully functional.",
            },

            evaluated_by: {
              type: "string",
              nullable: true,
              example: "6592b8f0c0d3e7a3d9c2a333",
            },

            evaluated_at: {
              type: "string",
              format: "date-time",
              nullable: true,
              example: "2026-01-01T10:00:00.000Z",
            },

            attachments: {
              type: "array",
              items: { type: "string", example: "6592b8f0c0d3e7a3d9c2a444" },
              description: "Referenced Attachment IDs (photos, documents)",
            },

            active_loan: {
              type: "string",
              nullable: true,
              example: "6592b8f0c0d3e7a3d9c2a555",
              description: "Active loan ID if the asset is currently pawned",
            },

            // discriminator key from mongoose: asset_type
            asset_type: {
              type: "string",
              nullable: true,
              example: "ElectronicsAsset",
              description:
                "Discriminator key (mongoose discriminatorKey). Examples: ElectronicsAsset, VehicleAsset, JewelleryAsset",
            },

            created_at: {
              type: "string",
              format: "date-time",
              example: "2026-01-01T09:30:00.000Z",
            },

            updated_at: {
              type: "string",
              format: "date-time",
              example: "2026-01-01T11:00:00.000Z",
            },

            // oneOf discriminator details payloads (see below)
            details: {
              nullable: true,
              description:
                "Subtype-specific fields. Use ElectronicsAssetDetails, VehicleAssetDetails, or JewelleryAssetDetails depending on asset_type.",
              oneOf: [
                { $ref: "#/components/schemas/ElectronicsAssetDetails" },
                { $ref: "#/components/schemas/VehicleAssetDetails" },
                { $ref: "#/components/schemas/JewelleryAssetDetails" },
              ],
            },
          },

          required: ["category", "title"],
        },

        Attachment: {
          type: "object",
          additionalProperties: false,

          properties: {
            _id: {
              type: "string",
              example: "6592d1e2c4f8a7b9d2a81111",
            },

            owner_user: {
              type: "string",
              nullable: true,
              example: "6592b8f0c0d3e7a3d9c2a111",
              description: "User ID who owns or uploaded the attachment",
            },

            entity_type: {
              type: "string",
              example: "Asset",
              description:
                "Type of entity this attachment is linked to (e.g. Asset, Loan, User, Ticket)",
            },

            entity_id: {
              type: "string",
              nullable: true,
              example: "6592b8f0c0d3e7a3d9c2a777",
              description: "Referenced entity ID",
            },

            category: {
              type: "string",
              enum: [
                "national_id",
                "loan_request_form",
                "pawn_ticket",
                "contract",
                "proof_of_residence",
                "asset_photos",
                "other",
              ],
              example: "asset_photos",
            },

            filename: {
              type: "string",
              example: "front-view.jpg",
            },

            mime_type: {
              type: "string",
              example: "image/jpeg",
            },

            storage: {
              type: "string",
              enum: ["gridfs", "s3", "local", "url"],
              example: "s3",
              description: "Storage backend used for this attachment",
            },

            url: {
              type: "string",
              format: "uri",
              nullable: true,
              example: "https://cdn.example.com/assets/front-view.jpg",
              description:
                "File access URL (used when storage is url/s3/local)",
            },

            gridfs_id: {
              type: "string",
              nullable: true,
              example: "6592d1e2c4f8a7b9d2a82222",
              description: "GridFS file ID (used when storage is gridfs)",
            },

            signed: {
              type: "boolean",
              example: false,
            },

            signed_by: {
              type: "string",
              nullable: true,
              example: "6592b8f0c0d3e7a3d9c2a333",
              description: "User ID who digitally signed the attachment",
            },

            signed_at: {
              type: "string",
              format: "date-time",
              nullable: true,
              example: "2026-01-01T12:00:00.000Z",
            },

            meta: {
              type: "object",
              nullable: true,
              example: {
                checksum: "a94a8fe5ccb19ba61c4c0873d391e987982fbbd3",
                page_count: 3,
              },
              description: "Flexible metadata for audit or storage extensions",
            },

            created_at: {
              type: "string",
              format: "date-time",
              example: "2026-01-01T09:00:00.000Z",
            },

            updated_at: {
              type: "string",
              format: "date-time",
              example: "2026-01-01T09:10:00.000Z",
            },
          },

          required: ["filename", "mime_type"],
        },

        Auction: {
          type: "object",
          additionalProperties: false,

          properties: {
            _id: {
              type: "string",
              example: "6592e1a9f4c8d1a2b9c31111",
            },

            auction_no: {
              type: "string",
              nullable: true,
              example: "AUC-000045",
              description: "Unique auction reference number",
            },

            asset: {
              type: "string",
              example: "6592b8f0c0d3e7a3d9c2a777",
              description: "Asset ID being auctioned",
            },

            starting_bid_amount: {
              type: "number",
              minimum: 0,
              example: 500,
              description: "Minimum bid amount to start the auction",
            },

            reserve_price: {
              type: "number",
              minimum: 0,
              nullable: true,
              example: 800,
              description:
                "Optional reserve price below which the asset will not be sold",
            },

            auction_type: {
              type: "string",
              enum: ["online", "in_person"],
              example: "online",
            },

            starts_at: {
              type: "string",
              format: "date-time",
              example: "2026-02-01T09:00:00.000Z",
              description: "Auction start date and time",
            },

            ends_at: {
              type: "string",
              format: "date-time",
              example: "2026-02-01T17:00:00.000Z",
              description: "Auction end date and time",
            },

            status: {
              type: "string",
              enum: ["draft", "live", "closed", "cancelled"],
              example: "draft",
            },

            winner_user: {
              type: "string",
              nullable: true,
              example: "6592b8f0c0d3e7a3d9c2a111",
              description:
                "Winning bidder User ID (set when auction is closed)",
            },

            winning_bid_amount: {
              type: "number",
              minimum: 0,
              nullable: true,
              example: 950,
              description: "Final winning bid amount",
            },

            created_by: {
              type: "string",
              nullable: true,
              example: "6592b8f0c0d3e7a3d9c2a333",
              description: "User ID who created the auction",
            },

            created_at: {
              type: "string",
              format: "date-time",
              example: "2026-01-15T10:00:00.000Z",
            },

            updated_at: {
              type: "string",
              format: "date-time",
              example: "2026-02-01T17:05:00.000Z",
            },
          },

          required: ["asset", "starting_bid_amount", "starts_at", "ends_at"],
        },
        AuditLog: {
          type: "object",
          additionalProperties: false,

          properties: {
            _id: {
              type: "string",
              example: "6592f1c7a9e3b4d2f8c81111",
            },

            actor_user: {
              type: "string",
              nullable: true,
              example: "6592b8f0c0d3e7a3d9c2a111",
              description: "User ID who performed the action",
            },

            actor_role_snapshot: {
              type: "array",
              items: { type: "string" },
              example: ["loan_officer_approval"],
              description: "Roles held by the user at the time of the action",
            },

            action: {
              type: "string",
              example: "loan.approve",
              description: "Action identifier (domain.action)",
            },

            entity_type: {
              type: "string",
              example: "Loan",
              description: "Entity type affected by the action",
            },

            entity_id: {
              type: "string",
              nullable: true,
              example: "6592b8f0c0d3e7a3d9c2a555",
              description: "Affected entity ID",
            },

            before: {
              type: "object",
              nullable: true,
              example: {
                status: "pending",
                approved_amount: null,
              },
              description: "Minimal snapshot before the action",
            },

            after: {
              type: "object",
              nullable: true,
              example: {
                status: "approved",
                approved_amount: 1000,
              },
              description: "Minimal snapshot after the action",
            },

            ip: {
              type: "string",
              nullable: true,
              example: "102.45.88.21",
              description: "IP address of the request origin",
            },

            user_agent: {
              type: "string",
              nullable: true,
              example: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
            },

            channel: {
              type: "string",
              enum: ["web", "mobile", "api", "admin"],
              example: "api",
              description: "Source channel of the action",
            },

            meta: {
              type: "object",
              nullable: true,
              example: {
                request_id: "req-778899",
                correlation_id: "corr-112233",
              },
              description: "Additional metadata for traceability",
            },

            created_at: {
              type: "string",
              format: "date-time",
              example: "2026-01-20T14:55:00.000Z",
              description: "Timestamp when the audit log was created",
            },
          },

          required: ["action", "entity_type"],
        },
        BidDispute: {
          type: "object",
          additionalProperties: false,
          properties: {
            status: {
              type: "string",
              enum: [
                "none",
                "raised",
                "under_review",
                "resolved_valid",
                "resolved_invalid",
              ],
              example: "none",
              description: "Dispute lifecycle status",
            },
            reason: {
              type: "string",
              nullable: true,
              example: "Bidder claims duplicate bid due to network issue.",
            },
            raised_by: {
              type: "string",
              nullable: true,
              example: "6592b8f0c0d3e7a3d9c2a111",
            },
            raised_at: {
              type: "string",
              format: "date-time",
              nullable: true,
              example: "2026-01-01T12:00:00.000Z",
            },
            resolved_by: {
              type: "string",
              nullable: true,
              example: "6592b8f0c0d3e7a3d9c2a222",
            },
            resolved_at: {
              type: "string",
              format: "date-time",
              nullable: true,
              example: "2026-01-02T09:30:00.000Z",
            },
            resolution_notes: {
              type: "string",
              nullable: true,
              example: "Reviewed logs; bid was valid and placed once.",
            },
          },
        },
        Bid: {
          type: "object",
          additionalProperties: false,

          properties: {
            _id: {
              type: "string",
              example: "6592fbe1c8d9a7b2f1aa1111",
            },

            auction: {
              type: "string",
              example: "6592e1a9f4c8d1a2b9c31111",
              description: "Auction ID this bid belongs to",
            },

            bidder_user: {
              type: "string",
              example: "6592b8f0c0d3e7a3d9c2a111",
              description: "User ID of the bidder",
            },

            amount: {
              type: "number",
              minimum: 0,
              example: 950,
              description: "Bid amount",
            },

            currency: {
              type: "string",
              example: "USD",
              description: "Bid currency",
            },

            placed_at: {
              type: "string",
              format: "date-time",
              example: "2026-01-01T12:05:00.000Z",
              description: "Time bid was placed",
            },

            dispute: {
              $ref: "#/components/schemas/BidDispute",
            },

            payment_status: {
              type: "string",
              enum: [
                "unpaid",
                "pending",
                "paid",
                "failed",
                "refunded",
                "cancelled",
              ],
              example: "unpaid",
              description:
                "Payment status for this bid (payment record stored separately)",
            },

            paid_amount: {
              type: "number",
              minimum: 0,
              example: 0,
              description: "Total amount paid so far for this bid",
            },

            paid_at: {
              type: "string",
              format: "date-time",
              nullable: true,
              example: "2026-01-01T13:00:00.000Z",
            },

            payment_reference: {
              type: "string",
              nullable: true,
              example: "PAY-REF-2026-000123",
              description: "Optional external payment gateway reference",
            },

            meta: {
              type: "object",
              nullable: true,
              example: {
                ip: "102.45.88.21",
                device: "mobile",
              },
              description: "Additional metadata for audit/traceability",
            },

            created_at: {
              type: "string",
              format: "date-time",
              example: "2026-01-01T12:05:00.000Z",
            },

            updated_at: {
              type: "string",
              format: "date-time",
              example: "2026-01-01T12:10:00.000Z",
            },
          },

          required: ["auction", "bidder_user", "amount"],
        },
        BidPayment: {
          type: "object",
          additionalProperties: false,

          properties: {
            _id: {
              type: "string",
              example: "6593002fc8d9a7b2f1aa2222",
            },

            bid: {
              type: "string",
              example: "6592fbe1c8d9a7b2f1aa1111",
              description: "Bid ID this payment belongs to",
            },

            auction: {
              type: "string",
              nullable: true,
              example: "6592e1a9f4c8d1a2b9c31111",
              description: "Auction ID (optional denormalized link)",
            },

            payer_user: {
              type: "string",
              example: "6592b8f0c0d3e7a3d9c2a111",
              description: "User ID of the payer (usually the bidder)",
            },

            amount: {
              type: "number",
              minimum: 0,
              example: 950,
            },

            currency: {
              type: "string",
              example: "USD",
            },

            status: {
              type: "string",
              enum: [
                "initiated",
                "pending",
                "success",
                "failed",
                "refunded",
                "cancelled",
              ],
              example: "initiated",
              description: "Payment lifecycle status",
            },

            method: {
              type: "string",
              nullable: true,
              example: "mobile_money",
              description:
                "Payment method (e.g. cash, bank, mobile money, card)",
            },

            provider: {
              type: "string",
              nullable: true,
              example: "paynow",
              description: "Payment provider/gateway (optional)",
            },

            provider_txn_id: {
              type: "string",
              nullable: true,
              example: "PN-2026-000123456",
              description: "Provider transaction reference (optional)",
            },

            receipt_no: {
              type: "string",
              nullable: true,
              example: "RCT-0000987",
              description: "Receipt number (optional)",
            },

            notes: {
              type: "string",
              nullable: true,
              example: "Paid via EcoCash at counter.",
            },

            paid_at: {
              type: "string",
              format: "date-time",
              nullable: true,
              example: "2026-01-01T13:20:00.000Z",
              description: "Timestamp when payment was completed/recorded",
            },

            meta: {
              type: "object",
              nullable: true,
              example: {
                channel: "web",
                ip: "102.45.88.21",
              },
              description: "Additional metadata for traceability",
            },

            created_at: {
              type: "string",
              format: "date-time",
              example: "2026-01-01T13:10:00.000Z",
            },

            updated_at: {
              type: "string",
              format: "date-time",
              example: "2026-01-01T13:20:00.000Z",
            },
          },

          required: ["bid", "payer_user", "amount"],
        },
        DebtorRecord: {
          type: "object",
          additionalProperties: false,

          properties: {
            _id: {
              type: "string",
              example: "6593100ac8d9a7b2f1aa3333",
            },

            source: {
              type: "string",
              example: "Debtors_list_final.csv",
              description:
                "Source file or system from which the record was imported",
            },

            source_period_label: {
              type: "string",
              nullable: true,
              example: "JUNE 2023-NOVEMBER 2025",
              description: "Reporting period covered by the source data",
            },

            asset_no: {
              type: "string",
              nullable: true,
              example: "AST-000045",
              description: "Internal or legacy asset reference number",
            },

            client_name: {
              type: "string",
              nullable: true,
              example: "John Doe",
              description: "Name of the debtor/client as per source records",
            },

            principal: {
              type: "number",
              nullable: true,
              example: 1000,
            },

            interest: {
              type: "number",
              nullable: true,
              example: 250,
            },

            period: {
              type: "string",
              nullable: true,
              example: "12 months",
            },

            amount_due: {
              type: "number",
              nullable: true,
              example: 1250,
            },

            penalties: {
              type: "number",
              nullable: true,
              example: 50,
            },

            total_due: {
              type: "number",
              nullable: true,
              example: 1300,
            },

            profit_loss_on_sale: {
              type: "number",
              nullable: true,
              example: -200,
              description: "Profit or loss realised after asset sale",
            },

            date_of: {
              type: "string",
              format: "date",
              nullable: true,
              example: "2024-06-15",
              description:
                "Date reference from source sheet (meaning depends on source)",
            },

            due_date: {
              type: "string",
              format: "date",
              nullable: true,
              example: "2024-12-15",
            },

            asset: {
              type: "string",
              nullable: true,
              example: "Vehicle - Toyota Hilux",
              description: "Asset description or type",
            },

            specs: {
              type: "string",
              nullable: true,
              example: "2.8 GD-6, Double Cab",
            },

            asset_code: {
              type: "string",
              nullable: true,
              example: "VH-TOY-001",
            },

            reg_or_serial_no: {
              type: "string",
              nullable: true,
              example: "ABZ1234",
              description: "Vehicle registration number or serial number",
            },

            account_status: {
              type: "string",
              nullable: true,
              example: "UNPAID",
              description:
                "Account status from source system (e.g. PAID / UNPAID / DEFAULT)",
            },

            contact_details: {
              type: "string",
              nullable: true,
              example: "+263771234567",
            },

            branch: {
              type: "string",
              nullable: true,
              example: "Harare Main Branch",
            },

            matched_user: {
              type: "string",
              nullable: true,
              example: "6592b8f0c0d3e7a3d9c2a111",
              description:
                "Linked User ID if the debtor was matched to a system user",
            },

            raw: {
              type: "object",
              nullable: true,
              example: {
                COLUMN_A: "value",
                COLUMN_B: "value",
              },
              description: "Original raw row data preserved for traceability",
            },

            imported_at: {
              type: "string",
              format: "date-time",
              example: "2026-01-01T08:00:00.000Z",
              description: "Timestamp when the record was imported",
            },

            created_at: {
              type: "string",
              format: "date-time",
              example: "2026-01-01T08:00:00.000Z",
            },

            updated_at: {
              type: "string",
              format: "date-time",
              example: "2026-01-01T08:05:00.000Z",
            },
          },
        },
        DocumentTemplate: {
          type: "object",
          additionalProperties: false,

          properties: {
            _id: {
              type: "string",
              example: "6593201bc8d9a7b2f1aa4444",
            },

            code: {
              type: "string",
              enum: [
                "LOAN_REQUEST_FORM",
                "PAWN_CONTRACT_MOTOR_VEHICLE",
                "PAWN_CONTRACT_OTHER_MOVABLES",
              ],
              example: "PAWN_CONTRACT_MOTOR_VEHICLE",
              description:
                "Unique business code identifying the document template",
            },

            title: {
              type: "string",
              example: "Pawn Contract – Motor Vehicle",
              description: "Human-readable document title",
            },

            version: {
              type: "string",
              example: "v1",
              description: "Template version identifier",
            },

            file_url: {
              type: "string",
              format: "uri",
              example:
                "https://cdn.example.com/templates/pawn_contract_motor_vehicle_v1.pdf",
              description: "URL to the stored DOCX/PDF template file",
            },

            is_active: {
              type: "boolean",
              example: true,
              description:
                "Whether this template is currently active and usable",
            },

            created_by_user_id: {
              type: "string",
              nullable: true,
              example: "6592b8f0c0d3e7a3d9c2a111",
              description: "User ID who uploaded or created the template",
            },

            created_at: {
              type: "string",
              format: "date-time",
              example: "2026-01-01T09:00:00.000Z",
              description: "Timestamp when the template was created",
            },
          },

          required: ["code", "title", "file_url"],
        },
        InventoryTransaction: {
          type: "object",
          additionalProperties: false,

          properties: {
            _id: {
              type: "string",
              example: "6593302fc8d9a7b2f1aa5555",
            },

            tx_no: {
              type: "string",
              nullable: true,
              example: "TX-00001234",
              description: "Unique transaction reference number",
            },

            type: {
              type: "string",
              enum: [
                "loan_disbursement",
                "repayment",
                "interest_income",
                "storage_income",
                "penalty_income",
                "asset_sale",
                "asset_purchase",
                "expense",
                "adjustment",
              ],
              example: "repayment",
              description:
                "Transaction classification for inventory and P&L tracking",
            },

            amount: {
              type: "number",
              example: 500,
              description: "Transaction amount",
            },

            currency: {
              type: "string",
              example: "USD",
            },

            asset: {
              type: "string",
              nullable: true,
              example: "6592b8f0c0d3e7a3d9c2a777",
              description: "Related asset ID (if applicable)",
            },

            loan: {
              type: "string",
              nullable: true,
              example: "6592b8f0c0d3e7a3d9c2a888",
              description: "Related loan ID (if applicable)",
            },

            payment: {
              type: "string",
              nullable: true,
              example: "6593002fc8d9a7b2f1aa2222",
              description: "Related payment record ID (if applicable)",
            },

            account_code: {
              type: "string",
              nullable: true,
              example: "GL-INT-INCOME",
              description: "Optional general ledger / account mapping code",
            },

            notes: {
              type: "string",
              nullable: true,
              example: "Monthly loan repayment including interest",
            },

            occurred_at: {
              type: "string",
              format: "date-time",
              example: "2026-01-31T15:30:00.000Z",
              description: "Date and time when the transaction occurred",
            },

            created_by: {
              type: "string",
              nullable: true,
              example: "6592b8f0c0d3e7a3d9c2a111",
              description: "User ID who recorded the transaction",
            },

            meta: {
              type: "object",
              nullable: true,
              example: {
                source: "auto_posting",
                reconciliation_id: "recon-2026-01",
              },
              description:
                "Additional metadata for accounting and reconciliation",
            },

            created_at: {
              type: "string",
              format: "date-time",
              example: "2026-01-31T15:31:00.000Z",
            },

            updated_at: {
              type: "string",
              format: "date-time",
              example: "2026-01-31T15:31:00.000Z",
            },
          },

          required: ["type", "amount", "occurred_at"],
        },
        LedgerEntry: {
          type: "object",
          additionalProperties: false,

          properties: {
            _id: {
              type: "string",
              example: "6593405bc8d9a7b2f1aa6666",
            },

            entry_date: {
              type: "string",
              format: "date-time",
              example: "2026-01-31T00:00:00.000Z",
              description: "Accounting date for the ledger entry",
            },

            branch_code: {
              type: "string",
              nullable: true,
              example: "HRE-MAIN",
              description:
                "Branch code for branch-level accounting and reporting",
            },

            category: {
              type: "string",
              enum: [
                "interest_income",
                "storage_income",
                "penalty_income",
                "loan_disbursement",
                "loan_principal_repayment",
                "asset_sale_revenue",
                "asset_sale_cogs",
                "write_off",
                "adjustment",
                "other",
              ],
              example: "interest_income",
              description: "Ledger category classification",
            },

            amount: {
              type: "number",
              example: 120.5,
              description:
                "Signed amount (+income, −expense/outflow). Sign determines accounting direction.",
            },

            currency: {
              type: "string",
              enum: ["USD", "ZWG"],
              example: "USD",
            },

            refs: {
              type: "object",
              nullable: true,
              description: "Optional references to related system entities",
              properties: {
                loan_id: {
                  type: "string",
                  nullable: true,
                  example: "6592b8f0c0d3e7a3d9c2a888",
                },
                payment_id: {
                  type: "string",
                  nullable: true,
                  example: "6593002fc8d9a7b2f1aa2222",
                },
                asset_id: {
                  type: "string",
                  nullable: true,
                  example: "6592b8f0c0d3e7a3d9c2a777",
                },
                inventory_txn_id: {
                  type: "string",
                  nullable: true,
                  example: "6593302fc8d9a7b2f1aa5555",
                },
              },
            },

            memo: {
              type: "string",
              nullable: true,
              example: "Interest income for Loan #LN-00045",
            },

            created_by_user_id: {
              type: "string",
              nullable: true,
              example: "6592b8f0c0d3e7a3d9c2a111",
              description: "User ID who created the ledger entry",
            },

            created_at: {
              type: "string",
              format: "date-time",
              example: "2026-01-31T15:45:00.000Z",
              description: "Timestamp when the ledger entry was recorded",
            },
          },

          required: ["category", "amount"],
        },

        Loan: {
          type: "object",
          additionalProperties: false,

          properties: {
            _id: {
              type: "string",
              example: "6593507cc8d9a7b2f1aa7777",
            },

            loan_no: {
              type: "string",
              nullable: true,
              example: "LN-000045",
              description: "Unique loan reference number",
            },

            customer_user: {
              type: "string",
              example: "6592b8f0c0d3e7a3d9c2a111",
              description: "Customer (borrower) User ID",
            },

            application: {
              type: "string",
              nullable: true,
              example: "6592b8f0c0d3e7a3d9c2a222",
              description: "Associated loan application ID",
            },

            asset: {
              type: "string",
              example: "6592b8f0c0d3e7a3d9c2a777",
              description: "Asset pledged as collateral",
            },

            collateral_category: {
              type: "string",
              enum: ["small_loans", "motor_vehicle", "jewellery"],
              example: "motor_vehicle",
              description: "Collateral category determining loan terms",
            },

            principal_amount: {
              type: "number",
              minimum: 0,
              example: 2000,
              description: "Original loan principal",
            },

            current_balance: {
              type: "number",
              minimum: 0,
              example: 1800,
              description: "Current outstanding balance (reducing balance)",
            },

            currency: {
              type: "string",
              example: "USD",
            },

            interest_rate_percent: {
              type: "number",
              example: 4,
              description: "Interest rate percentage per interest period",
            },

            interest_period_days: {
              type: "number",
              example: 30,
              description: "Interest calculation period in days",
            },

            storage_charge_percent: {
              type: "number",
              example: 21,
              description: "Storage charge percentage",
            },

            penalty_percent: {
              type: "number",
              example: 10,
              description: "Penalty percentage for late payment",
            },

            grace_days: {
              type: "number",
              example: 7,
              description: "Grace period (days) before auction eligibility",
            },

            disbursed_at: {
              type: "string",
              format: "date-time",
              nullable: true,
              example: "2026-02-01T10:00:00.000Z",
              description: "Date the loan was disbursed",
            },

            start_date: {
              type: "string",
              format: "date",
              example: "2026-02-01",
              description: "Loan start date",
            },

            due_date: {
              type: "string",
              format: "date",
              example: "2026-03-03",
              description: "Loan due date",
            },

            status: {
              type: "string",
              enum: [
                "draft",
                "active",
                "overdue",
                "in_grace",
                "auction",
                "sold",
                "redeemed",
                "closed",
                "cancelled",
              ],
              example: "active",
              description: "Current loan lifecycle status",
            },

            attachments: {
              type: "array",
              items: {
                type: "string",
                example: "6592d1e2c4f8a7b9d2a81111",
              },
              description: "Linked contract/forms attachments",
            },

            created_by: {
              type: "string",
              nullable: true,
              example: "6592b8f0c0d3e7a3d9c2a333",
              description: "User who created the loan",
            },

            processed_by: {
              type: "string",
              nullable: true,
              example: "6592b8f0c0d3e7a3d9c2a444",
              description: "User who processed the loan",
            },

            approved_by: {
              type: "string",
              nullable: true,
              example: "6592b8f0c0d3e7a3d9c2a555",
              description: "User who approved the loan",
            },

            meta: {
              type: "object",
              nullable: true,
              example: {
                risk_band: "medium",
                source: "branch-entry",
              },
              description: "Additional metadata for underwriting and audit",
            },

            created_at: {
              type: "string",
              format: "date-time",
              example: "2026-02-01T09:45:00.000Z",
            },

            updated_at: {
              type: "string",
              format: "date-time",
              example: "2026-02-15T14:20:00.000Z",
            },
          },

          required: [
            "customer_user",
            "asset",
            "collateral_category",
            "principal_amount",
            "current_balance",
            "interest_rate_percent",
            "interest_period_days",
            "storage_charge_percent",
            "start_date",
            "due_date",
          ],
        },

        Employment: {
          type: "object",
          additionalProperties: false,
          properties: {
            employment_type: {
              type: "string",
              nullable: true,
              example: "Permanent",
            },
            title: { type: "string", nullable: true, example: "Accountant" },
            duration: { type: "string", nullable: true, example: "3 years" },
            location: { type: "string", nullable: true, example: "Harare" },
            contacts: {
              type: "string",
              nullable: true,
              example: "+263771234567",
            },
          },
        },
        DebtorCheck: {
          type: "object",
          additionalProperties: false,
          properties: {
            checked: { type: "boolean", example: false },
            matched: { type: "boolean", example: false },

            matched_debtor_records: {
              type: "array",
              items: { type: "string", example: "6593100ac8d9a7b2f1aa3333" },
              example: [],
              description: "Referenced DebtorRecord IDs if matched",
            },

            notes: {
              type: "string",
              nullable: true,
              example: "No match found.",
            },

            checked_at: {
              type: "string",
              format: "date-time",
              nullable: true,
              example: "2026-01-01T10:00:00.000Z",
            },

            checked_by: {
              type: "string",
              nullable: true,
              example: "6592b8f0c0d3e7a3d9c2a111",
              description: "User who performed the debtor check",
            },
          },
        },
        LoanApplication: {
          type: "object",
          additionalProperties: false,

          properties: {
            _id: { type: "string", example: "6593608dc8d9a7b2f1aa8888" },

            application_no: {
              type: "string",
              nullable: true,
              example: "APP-000123",
              description: "Unique application reference number",
            },

            customer_user: {
              type: "string",
              example: "6592b8f0c0d3e7a3d9c2a111",
              description: "Customer (applicant) User ID",
            },

            // PERSONAL DETAILS
            full_name: { type: "string", example: "John Doe" },

            national_id_number: {
              type: "string",
              example: "63-1234567-A-12",
              description: "Applicant national ID number",
            },

            gender: { type: "string", nullable: true, example: "Male" },

            date_of_birth: {
              type: "string",
              format: "date",
              nullable: true,
              example: "1995-06-14",
            },

            marital_status: {
              type: "string",
              nullable: true,
              example: "Single",
            },

            contact_details: {
              type: "string",
              nullable: true,
              example: "+263771234567",
            },

            alternative_number: {
              type: "string",
              nullable: true,
              example: "+263774567890",
            },

            email_address: {
              type: "string",
              format: "email",
              nullable: true,
              example: "john.doe@example.com",
            },

            home_address: {
              type: "string",
              nullable: true,
              example: "123 Samora Machel Ave, Harare",
            },

            // EMPLOYMENT
            employment: {
              $ref: "#/components/schemas/Employment",
            },

            // BASIC INFORMATION
            requested_loan_amount: {
              type: "number",
              minimum: 0,
              example: 1500,
            },

            collateral_category: {
              type: "string",
              enum: ["small_loans", "motor_vehicle", "jewellery"],
              example: "small_loans",
            },

            collateral_description: {
              type: "string",
              nullable: true,
              example: "Dell Laptop, Core i7, 16GB RAM",
            },

            surety_description: {
              type: "string",
              nullable: true,
              example: "Surety: Salary-backed repayment",
            },

            declared_asset_value: {
              type: "number",
              minimum: 0,
              nullable: true,
              example: 2000,
            },

            // DECLARATION
            declaration_text: {
              type: "string",
              nullable: true,
              example:
                "I declare the information provided is true and correct.",
            },

            declaration_signed_at: {
              type: "string",
              format: "date-time",
              nullable: true,
              example: "2026-01-01T09:00:00.000Z",
            },

            declaration_signature_name: {
              type: "string",
              nullable: true,
              example: "John Doe",
            },

            // WORKFLOW
            status: {
              type: "string",
              enum: [
                "draft",
                "submitted",
                "processing",
                "approved",
                "rejected",
                "cancelled",
              ],
              example: "submitted",
            },

            debtor_check: {
              $ref: "#/components/schemas/DebtorCheck",
            },

            attachments: {
              type: "array",
              items: { type: "string", example: "6592d1e2c4f8a7b9d2a81111" },
              description:
                "Attachment IDs (ID scans, signed request form, etc.)",
            },

            internal_notes: {
              type: "string",
              nullable: true,
              example: "Customer requested urgent processing.",
            },

            created_at: {
              type: "string",
              format: "date-time",
              example: "2026-01-01T08:30:00.000Z",
            },

            updated_at: {
              type: "string",
              format: "date-time",
              example: "2026-01-01T09:15:00.000Z",
            },
          },

          required: [
            "customer_user",
            "full_name",
            "national_id_number",
            "requested_loan_amount",
            "collateral_category",
          ],
        },

        LoanTerm: {
          type: "object",
          additionalProperties: false,

          properties: {
            _id: {
              type: "string",
              example: "6593709ec8d9a7b2f1aa9999",
            },

            loan: {
              type: "string",
              example: "6593507cc8d9a7b2f1aa7777",
              description: "Parent loan ID",
            },

            term_no: {
              type: "integer",
              example: 1,
              description: "Sequential term number (1, 2, 3, …)",
            },

            start_date: {
              type: "string",
              format: "date",
              example: "2026-02-01",
              description: "Start date of the loan term",
            },

            due_date: {
              type: "string",
              format: "date",
              example: "2026-03-03",
              description: "Due date for this term",
            },

            opening_balance: {
              type: "number",
              minimum: 0,
              example: 2000,
              description: "Opening balance at the start of the term",
            },

            closing_balance: {
              type: "number",
              minimum: 0,
              example: 1800,
              description: "Closing balance at the end of the term",
            },

            interest_rate_percent: {
              type: "number",
              example: 4,
              description: "Interest rate percentage for the term",
            },

            interest_period_days: {
              type: "number",
              example: 30,
              description: "Interest calculation period in days",
            },

            storage_charge_percent: {
              type: "number",
              example: 21,
              description: "Storage charge percentage for the term",
            },

            renewal_type: {
              type: "string",
              enum: [
                "initial",
                "interest_only_renewal",
                "partial_principal_renewal",
                "full_settlement",
              ],
              example: "initial",
              description: "Type of term or renewal applied",
            },

            approved_by: {
              type: "string",
              nullable: true,
              example: "6592b8f0c0d3e7a3d9c2a111",
              description: "User ID who approved this term",
            },

            approved_at: {
              type: "string",
              format: "date-time",
              nullable: true,
              example: "2026-02-01T09:00:00.000Z",
            },

            notes: {
              type: "string",
              nullable: true,
              example:
                "Interest-only renewal approved due to customer request.",
            },

            created_at: {
              type: "string",
              format: "date-time",
              example: "2026-02-01T08:55:00.000Z",
            },

            updated_at: {
              type: "string",
              format: "date-time",
              example: "2026-02-01T09:00:00.000Z",
            },
          },

          required: [
            "loan",
            "term_no",
            "start_date",
            "due_date",
            "opening_balance",
            "closing_balance",
            "interest_rate_percent",
            "interest_period_days",
            "storage_charge_percent",
          ],
        },
        SignedDocument: {
          type: "object",
          additionalProperties: false,

          properties: {
            _id: {
              type: "string",
              example: "659381a2c8d9a7b2f1aa0001",
            },

            template_id: {
              type: "string",
              nullable: true,
              example: "6593201bc8d9a7b2f1aa4444",
              description: "Referenced DocumentTemplate ID",
            },

            template_code_snapshot: {
              type: "string",
              nullable: true,
              example: "PAWN_CONTRACT_MOTOR_VEHICLE",
              description: "Snapshot of template code at time of signing",
            },

            applicant_user_id: {
              type: "string",
              nullable: true,
              example: "6592b8f0c0d3e7a3d9c2a111",
              description: "Applicant / customer User ID",
            },

            loan_application_id: {
              type: "string",
              nullable: true,
              example: "6593608dc8d9a7b2f1aa8888",
              description: "Associated loan application ID",
            },

            loan_id: {
              type: "string",
              nullable: true,
              example: "6593507cc8d9a7b2f1aa7777",
              description: "Associated loan ID (if approved)",
            },

            asset_id: {
              type: "string",
              nullable: true,
              example: "6592b8f0c0d3e7a3d9c2a777",
              description: "Associated collateral asset ID",
            },

            file_url: {
              type: "string",
              format: "uri",
              example: "https://cdn.example.com/signed/pawn_contract_00045.pdf",
              description: "URL to the signed document file",
            },

            mime_type: {
              type: "string",
              example: "application/pdf",
            },

            signed_by_name: {
              type: "string",
              nullable: true,
              example: "John Doe",
              description: "Name of the person who signed the document",
            },

            signed_by_user_id: {
              type: "string",
              nullable: true,
              example: "6592b8f0c0d3e7a3d9c2a111",
              description: "User ID of the signer (if applicable)",
            },

            signed_at: {
              type: "string",
              format: "date-time",
              example: "2026-02-01T10:15:00.000Z",
              description: "Timestamp when the document was signed",
            },

            witness_name: {
              type: "string",
              nullable: true,
              example: "Jane Smith",
              description: "Name of the witness (if required)",
            },

            witness_user_id: {
              type: "string",
              nullable: true,
              example: "6592b8f0c0d3e7a3d9c2a222",
              description: "User ID of the witness (if system user)",
            },

            status: {
              type: "string",
              enum: ["uploaded", "verified", "rejected"],
              example: "uploaded",
              description: "Verification status of the signed document",
            },

            created_at: {
              type: "string",
              format: "date-time",
              example: "2026-02-01T10:20:00.000Z",
              description:
                "Timestamp when the signed document record was created",
            },
          },

          required: ["file_url"],
        },

        SupportTicket: {
          type: "object",
          additionalProperties: false,

          properties: {
            _id: {
              type: "string",
              example: "659390b8c8d9a7b2f1aa1111",
            },

            ticket_no: {
              type: "string",
              nullable: true,
              example: "TCK-000456",
              description: "Unique support ticket reference number",
            },

            created_by_user: {
              type: "string",
              nullable: true,
              example: "6592b8f0c0d3e7a3d9c2a333",
              description: "User ID who created the ticket (staff or system)",
            },

            customer_user: {
              type: "string",
              nullable: true,
              example: "6592b8f0c0d3e7a3d9c2a111",
              description: "Customer User ID associated with the ticket",
            },

            category: {
              type: "string",
              nullable: true,
              example: "loan",
              description: "Ticket category (loan, payment, auction, etc.)",
            },

            subject: {
              type: "string",
              example: "Loan repayment not reflecting",
              description: "Short summary of the issue",
            },

            description: {
              type: "string",
              nullable: true,
              example:
                "Customer reports that repayment made yesterday is not showing.",
            },

            status: {
              type: "string",
              enum: ["open", "in_progress", "resolved", "closed"],
              example: "open",
              description: "Current support ticket status",
            },

            priority: {
              type: "string",
              enum: ["low", "medium", "high", "urgent"],
              example: "medium",
              description: "Ticket priority level",
            },

            assigned_to: {
              type: "string",
              nullable: true,
              example: "6592b8f0c0d3e7a3d9c2a444",
              description: "User ID of the support agent assigned",
            },

            attachments: {
              type: "array",
              items: {
                type: "string",
                example: "6592d1e2c4f8a7b9d2a81111",
              },
              description: "Attachment IDs linked to the ticket",
            },

            meta: {
              type: "object",
              nullable: true,
              example: {
                channel: "web",
                escalation_level: 1,
              },
              description: "Additional metadata for support workflows",
            },

            created_at: {
              type: "string",
              format: "date-time",
              example: "2026-02-05T09:10:00.000Z",
            },

            updated_at: {
              type: "string",
              format: "date-time",
              example: "2026-02-05T11:30:00.000Z",
            },
          },

          required: ["subject"],
        },
        PaymentRefund: {
          type: "object",
          additionalProperties: false,
          properties: {
            amount: {
              type: "number",
              example: 50,
            },
            provider_ref: {
              type: "string",
              nullable: true,
              example: "REFUND-2026-00012",
            },
            at: {
              type: "string",
              format: "date-time",
              example: "2026-02-10T14:30:00.000Z",
            },
          },
          required: ["amount"],
        },

        Payment: {
          type: "object",
          additionalProperties: false,

          properties: {
            _id: {
              type: "string",
              example: "6593a1d9c8d9a7b2f1aa2222",
            },

            /* ---------- Loan Context ---------- */
            loan: {
              type: "string",
              example: "6593507cc8d9a7b2f1aa7777",
              description: "Associated Loan ID",
            },

            loan_term: {
              type: "string",
              nullable: true,
              example: "6593709ec8d9a7b2f1aa9999",
              description: "Loan term this payment applies to (optional)",
            },

            /* ---------- Payment Amounts ---------- */
            amount: {
              type: "number",
              minimum: 0,
              example: 500,
              description: "Total payment amount",
            },

            currency: {
              type: "string",
              enum: ["USD", "ZWL"],
              example: "USD",
            },

            interest_component: {
              type: "number",
              minimum: 0,
              example: 120,
              description: "Portion allocated to interest",
            },

            principal_component: {
              type: "number",
              minimum: 0,
              example: 300,
              description: "Portion allocated to principal repayment",
            },

            storage_component: {
              type: "number",
              minimum: 0,
              example: 60,
              description: "Portion allocated to storage charges",
            },

            penalty_component: {
              type: "number",
              minimum: 0,
              example: 20,
              description: "Portion allocated to penalties",
            },

            /* ---------- Provider / Method ---------- */
            provider: {
              type: "string",
              enum: ["paynow", "ecocash", "bank_transfer", "cash"],
              example: "ecocash",
            },

            method: {
              type: "string",
              enum: ["card", "wallet", "bank", "cash"],
              example: "wallet",
            },

            payment_status: {
              type: "string",
              enum: [
                "paid",
                "pending",
                "failed",
                "cancelled",
                "awaiting_confirmation",
              ],
              example: "paid",
            },

            /* ---------- Provider Fields ---------- */
            poll_url: {
              type: "string",
              nullable: true,
              example:
                "https://paynow.co.zw/Interface/CheckPayment/?guid=abc123",
            },

            provider_ref: {
              type: "string",
              nullable: true,
              example: "PN-2026-000456",
            },

            paynow_invoice_id: {
              type: "string",
              nullable: true,
              example: "INV-778899",
            },

            captured_at: {
              type: "string",
              format: "date-time",
              nullable: true,
              example: "2026-02-10T13:45:00.000Z",
            },

            /* ---------- Refunds ---------- */
            refunds: {
              type: "array",
              items: {
                $ref: "#/components/schemas/PaymentRefund",
              },
            },

            /* ---------- Audit ---------- */
            payment_method_label: {
              type: "string",
              nullable: true,
              example: "EcoCash USD",
            },

            paid_at: {
              type: "string",
              format: "date-time",
              example: "2026-02-10T13:40:00.000Z",
            },

            received_by: {
              type: "string",
              nullable: true,
              example: "6592b8f0c0d3e7a3d9c2a444",
              description: "User who received/recorded the payment",
            },

            receipt_no: {
              type: "string",
              nullable: true,
              example: "RCT-000123",
            },

            meta: {
              type: "object",
              nullable: true,
              example: {
                channel: "branch",
                terminal_id: "POS-01",
              },
            },

            created_at: {
              type: "string",
              format: "date-time",
              example: "2026-02-10T13:35:00.000Z",
            },

            updated_at: {
              type: "string",
              format: "date-time",
              example: "2026-02-10T13:45:00.000Z",
            },
          },

          required: ["loan", "amount"],
        },

        // ---------- ERROR ----------

        Error: {
          type: "object",
          properties: {
            message: {
              type: "string",
              example: "Error message",
            },
            error: {
              type: "string",
              example: "Detailed error description",
            },
          },
        },
      },

      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
    },

    security: [
      {
        bearerAuth: [],
      },
    ],

    tags: [
      {
        name: "Users",
        description: "Operations related to users",
      },
      {
        name: "Asset Valuations",
        description:
          "Operations related to asset valuation and appraisal workflows, including market and final valuations, evaluator assignments, valuation methods, credit checks, attachments, and compliance with BRS two-stage evaluation requirements.",
      },
      {
        name: "Assets",
        description:
          "Operations related to asset submission, categorization, lifecycle tracking (submitted → valuating → pawned/auction/sold/redeemed/closed), storage location management, attachments, and asset subtype details for electronics, vehicles, and jewellery.",
      },
      {
        name: "Attachments",
        description:
          "Operations related to file and document attachments linked to system entities such as users, assets, loans, and tickets. Supports multiple storage strategies (URL, S3, GridFS), digital signing, and audit metadata.",
      },
      {
        name: "Auctions",
        description:
          "Operations related to asset auctions, including auction setup, scheduling, bidding lifecycle, reserve pricing, winner determination, and auction closure for pawned or forfeited assets.",
      },
      {
        name: "Audit Logs",
        description:
          "Read-only operations related to system audit logs capturing user actions, role snapshots, entity changes, request context, and metadata for compliance, traceability, and forensic analysis.",
      },
      {
        name: "Bids",
        description:
          "Operations related to auction bids, including bid placement, dispute tracking and resolution, payment status lifecycle, and bid auditing per auction.",
      },
      {
        name: "Bid Payments",
        description:
          "Operations related to bid payment records, including payment initiation, status tracking (pending/success/failed/refunded), provider references, receipts, and audit metadata. Payments are linked to bids and bidders in the auction workflow.",
      },
      {
        name: "Debtor Records",
        description:
          "Operations related to imported debtor records from legacy or external sources, including outstanding balances, asset details, repayment status, profit/loss tracking, and optional linkage to registered system users for reconciliation and reporting.",
      },
      {
        name: "Document Templates",
        description:
          "Operations related to document templates used for loan requests and pawn contracts, including template versioning, activation control, and management of stored DOCX/PDF files for document generation and signing workflows.",
      },
      {
        name: "Inventory Transactions",
        description:
          "Operations related to financial and inventory transactions, including loan disbursements, repayments, income recognition, asset sales and purchases, expenses, adjustments, and profit & loss classification.",
      },
      {
        name: "Ledger Entries",
        description:
          "Operations related to general ledger entries used for financial accounting, income recognition, expense tracking, write-offs, adjustments, and branch-level financial reporting.",
      },
      {
        name: "Loans",
        description:
          "Operations related to pawn loans, including loan creation, disbursement, interest and storage charges, repayment tracking, lifecycle status management, collateral linkage, and auction or redemption workflows.",
      },
      {
        name: "Loan Applications",
        description:
          "Operations related to loan applications, including applicant personal details, employment information, requested loan details, collateral declarations, debtor list checks, workflow approvals/rejections, and attachment handling.",
      },
      {
        name: "Loan Terms",
        description:
          "Operations related to loan term records, including initial terms, renewals, interest-only extensions, partial principal renewals, and full settlements, with balance tracking and approval history.",
      },
      {
        name: "Signed Documents",
        description:
          "Operations related to signed legal documents generated from templates, including pawn contracts and loan request forms. Supports applicant and witness signatures, verification status, and linkage to loan applications, loans, and assets.",
      },
      {
        name: "Support Tickets",
        description:
          "Operations related to customer and internal support tickets, including issue reporting, assignment, prioritization, status tracking, attachment handling, and resolution workflows.",
      },
      {
        name: "Payments",
        description:
          "Operations related to loan repayments, including payment allocation (interest, principal, storage, penalties), provider integrations, refunds, receipt tracking, and audit metadata.",
      },
    ],
  },
  apis: [
    "./routers/user_router.js", // adjust path if needed
    "./routers/debtor_record_router.js",
    "./routers/attachment_router.js",
    "./routers/loan_application_router.js",
    "./routers/asset_router.js",
    "./routers/loan_term_router.js",
    "./routers/loan_router.js",
    "./routers/payment_router.js",
    "./routers/support_ticket_router.js",
    "./routers/auction_router.js",
    "./routers/bid_router.js",
    "./routers/bid_payment_router.js",
    "./routers/audit_log_router.js",
    "./routers/inventory_transaction_router.js",
    "./routers/ledger_entry_router.js",
    "./routers/asset_valuation_router.js",
  ],
};

const specs = swaggerJsdoc(options);

module.exports = (app) => {
  app.use(
    "/api-docs",
    swaggerUi.serve,
    swaggerUi.setup(specs, {
      explorer: true,
      swaggerOptions: {
        validatorUrl: null,
        persistAuthorization: true,
      },
    })
  );
};
