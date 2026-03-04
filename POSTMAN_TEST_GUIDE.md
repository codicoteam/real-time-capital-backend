# Postman API Testing Guide

## Loan Application API Testing

### Base URL
```
http://localhost:7070/api/v1
```

### Authentication
All endpoints require Bearer Token authentication. Get your JWT token by logging in first.

**Header:**
```
Authorization: Bearer <your_jwt_token>
Content-Type: application/json
```

---

## Step 1: Create Loan Application (Draft)

**Endpoint:** `POST /loan-applications`

**Request Body:**
```
json
{
  "full_name": "Gowaz Gowa",
  "national_id_number": "242007854p05",
  "gender": "Male",
  "date_of_birth": "2007-05-14",
  "marital_status": "Single",
  "contact_details": "+263787259729",
  "alternative_number": "+263771234568",
  "email_address": "takundagowa@gmail.com",
  "home_address": "Ngezi phase2 no131, Kadoma",
  "employment": {
    "employment_type": "employed",
    "title": "Developer",
    "duration": "2 years",
    "location": "Kadoma",
    "contacts": "+263771234569"
  },
  "requested_loan_amount": 2000,
  "collateral_category": "motor_vehicle",
  "collateral_description": "Toyota Regius 2012",
  "surety_description": "Personal guarantee",
  "declared_asset_value": 9000
}
```

**Response:**
```
json
{
  "success": true,
  "data": {
    "application_no": "APP2602073",
    "status": "draft",
    "_id": "699f26e0e4d7fb1e74d6bbed"
  },
  "message": "Loan application draft created successfully"
}
```

---

## Step 2: Submit Loan Application (Generates Unsigned Document)

**Endpoint:** `POST /loan-applications/:id/submit`

**Replace `:id` with the application ID from Step 1**

**Request Body:**
```
json
{
  "full_name": "Gowaz Gowa",
  "national_id_number": "242007854p05",
  "gender": "Male",
  "date_of_birth": "2007-05-14",
  "marital_status": "Single",
  "contact_details": "+263787259729",
  "alternative_number": "+263771234568",
  "email_address": "takundagowa@gmail.com",
  "home_address": "Ngezi phase2 no131, Kadoma",
  "employment": {
    "employment_type": "employed",
    "title": "Developer",
    "duration": "2 years",
    "location": "Kadoma",
    "contacts": "+263771234569"
  },
  "requested_loan_amount": 2000,
  "collateral_category": "motor_vehicle",
  "collateral_description": "Toyota Regius 2012",
  "surety_description": "Personal guarantee",
  "declared_asset_value": 9000,
  "declaration_text": "I declare that the information provided is true and accurate",
  "declaration_signed_at": "2026-02-23T10:00:00.000Z",
  "declaration_signature_name": "Takunda Gowa"
}
```

**Response:**
```
json
{
  "success": true,
  "data": {
    "application_no": "APP2602073",
    "status": "submitted"
  },
  "message": "Loan application submitted successfully",
  "document": {
    "success": true,
    "data": {
      "signedDocumentId": "abc123...",
      "filename": "app_APP2602073_pawn_contract.pdf",
      "base64": "JVBERi0xLjQK...",
      "mimeType": "application/pdf"
    },
    "message": "Document generated successfully"
  }
}
```

**Note:** The `document.data.base64` contains the unsigned PDF. Save this to view the document before signing.

---

## Step 3: Sign Document (Stamp Signature on PDF)

**Endpoint:** `POST /signed-documents/:documentId/sign`

**Replace `:documentId` with the signedDocumentId from Step 2 response**

### Option A: Upload Signature File (Multipart Form Data)

**Content-Type:** `multipart/form-data`

**Form Fields:**
| Field | Type | Description |
|-------|------|-------------|
| signature | File | Signature image (PNG, JPG, JPEG, GIF) or PDF |
| signedByName | String | Name of person signing |

### Option B: Base64 Encoded Signature (JSON)

**Request Body:**
```
json
{
  "signatureBase64": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "signedByName": "Takunda Gowa"
}
```

**Response:**
```
json
{
  "success": true,
  "data": {
    "signedDocumentId": "abc123...",
    "filename": "app_APP2602073_pawn_contract_signed.pdf",
    "base64": "JVBERi0xLjQK...",
    "mimeType": "application/pdf",
    "signedAt": "2026-02-25T18:45:49.000Z",
    "signedBy": "Takunda Gowa"
  },
  "message": "Document signed successfully"
}
```

---

## Template Selection Based on Collateral Category

| Collateral Category | Template Used |
|---------------------|---------------|
| `motor_vehicle` | PAWN_CONTRACT_MOTOR_VEHICLE |
| `jewellery` | PAWN_CONTRACT_ELECTRICALS |
| `small_loans` | LOAN_REQUEST_FORM |

---

## Complete Testing Flow Summary

1. **POST /loan-applications** → Creates draft (ID: `699f26e0e4d7fb1e74d6bbed`)
2. **POST /loan-applications/699f26e0e4d7fb1e74d6bbed/submit** → Submits & generates unsigned PDF
3. **POST /signed-documents/{documentId}/sign** → Adds signature, returns signed PDF

---

## Additional Useful Endpoints

### Get All Applications
**Endpoint:** `GET /loan-applications`

### Get Single Application
**Endpoint:** `GET /loan-applications/:id`

### Update Application Status (Admin)
**Endpoint:** `PUT /loan-applications/:id/status`

**Request Body:**
```
json
{
  "status": "approved",
  "notes": "Application approved after verification"
}
```

### Get Application Documents
**Endpoint:** `GET /signed-documents/application/:applicationId`
