// Frontend Integration Example - React Component
// This shows how to use the document generation & signature feature from a frontend application

import React, { useState } from 'react';
import axios from 'axios';

const DocumentSignatureComponent = ({ applicationId, token }) => {
  const [loading, setLoading] = useState(false);
  const [documentId, setDocumentId] = useState(null);
  const [base64PDF, setBase64PDF] = useState(null);
  const [signatureBase64, setSignatureBase64] = useState(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [canvasRef, setCanvasRef] = React.useRef(null);

  const API_BASE = 'http://localhost:7070/api/v1';

  // ============================================
  // 1️⃣ GENERATE DOCUMENT FROM TEMPLATE
  // ============================================
  const generateDocument = async () => {
    try {
      setLoading(true);
      setStatusMessage('Generating document...');

      const response = await axios.post(
        `${API_BASE}/signed-documents/generate/${applicationId}`,
        { templateCode: 'LOAN_REQUEST_FORM' },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      const { data } = response.data;
      setDocumentId(data.signedDocumentId);
      setBase64PDF(data.base64);
      setStatusMessage('✅ Document generated successfully!');

      // Automatically display PDF
      displayPDF(data.base64);
    } catch (error) {
      setStatusMessage(`❌ Error: ${error.response?.data?.error || error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // ============================================
  // 2️⃣ DISPLAY PDF IN BROWSER
  // ============================================
  const displayPDF = (base64String) => {
    try {
      // Convert base64 to blob
      const binaryString = atob(base64String);
      const bytes = new Uint8Array(binaryString.length);
      
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const blob = new Blob([bytes], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);

      // Option 1: Open in new window/tab
      window.open(url, '_blank');

      // Option 2: Display in iframe
      const iframe = document.getElementById('pdf-viewer');
      if (iframe) {
        iframe.src = url;
      }
    } catch (error) {
      console.error('Error displaying PDF:', error);
    }
  };

  // ============================================
  // 3️⃣ DOWNLOAD PDF
  // ============================================
  const downloadPDF = (base64String, filename = 'loan-agreement.pdf') => {
    try {
      const binaryString = atob(base64String);
      const bytes = new Uint8Array(binaryString.length);

      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const blob = new Blob([bytes], { type: 'application/pdf' });
      const link = document.createElement('a');
      link.href = window.URL.createObjectURL(blob);
      link.download = filename;
      link.click();
      link.remove();

      setStatusMessage('✅ PDF downloaded successfully!');
    } catch (error) {
      setStatusMessage(`❌ Error downloading PDF: ${error.message}`);
    }
  };

// CAPTURE SIGNATURE FROM CANVAS

  const captureSignature = (canvasElement) => {
    try {
      // Convert canvas to base64 (remove 'data:image/png;base64,' prefix)
      const base64WithPrefix = canvasElement.toDataURL('image/png');
      const base64 = base64WithPrefix.split(',')[1];

      setSignatureBase64(base64);
      setStatusMessage('✅ Signature captured successfully!');
      return base64;
    } catch (error) {
      setStatusMessage(`❌ Error capturing signature: ${error.message}`);
      return null;
    }
  };

  // ============================================
  // 5️⃣ UPLOAD SIGNATURE & STAMP ON PDF
  // ============================================
  const signDocument = async (signedByName) => {
    try {
      if (!documentId) {
        setStatusMessage('❌ No document to sign. Generate a document first.');
        return;
      }

      if (!signatureBase64) {
        setStatusMessage('❌ No signature captured. Please draw your signature.');
        return;
      }

      setLoading(true);
      setStatusMessage('Signing document... (This may take a moment)');

      const response = await axios.post(
        `${API_BASE}/signed-documents/${documentId}/sign`,
        {
          signatureBase64: signatureBase64,
          signedByName: signedByName
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      const { data } = response.data;
      setBase64PDF(data.base64); // Update with signed PDF
      setStatusMessage('✅ Document signed successfully!');

      // Show the signed PDF
      displayPDF(data.base64);

      return data;
    } catch (error) {
      setStatusMessage(`❌ Error: ${error.response?.data?.error || error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // ============================================
  // 6️⃣ RETRIEVE SIGNED DOCUMENT
  // ============================================
  const retrieveDocument = async () => {
    try {
      if (!documentId) {
        setStatusMessage('❌ No document ID. Generate a document first.');
        return;
      }

      setLoading(true);
      setStatusMessage('Retrieving document...');

      const response = await axios.get(
        `${API_BASE}/signed-documents/${documentId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      const { base64, status, signed_by_name, signed_at } = response.data;
      setBase64PDF(base64);
      setStatusMessage(`✅ Document retrieved! Status: ${status}, Signed by: ${signed_by_name}`);

      displayPDF(base64);
    } catch (error) {
      setStatusMessage(`❌ Error: ${error.response?.data?.error || error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // ============================================
  // 7️⃣ GET ALL APPLICATION DOCUMENTS
  // ============================================
  const getApplicationDocuments = async () => {
    try {
      setLoading(true);
      setStatusMessage('Fetching documents...');

      const response = await axios.get(
        `${API_BASE}/signed-documents/application/${applicationId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      const documents = response.data;
      const documentList = documents
        .map(doc => `- ${doc._id} (${doc.status}) - Created: ${new Date(doc.created_at).toLocaleDateString()}`)
        .join('\n');

      setStatusMessage(`✅ Found ${documents.length} document(s):\n${documentList}`);
      return documents;
    } catch (error) {
      setStatusMessage(`❌ Error: ${error.response?.data?.error || error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // ============================================
  // 8️⃣ DELETE SIGNED DOCUMENT
  // ============================================
  const deleteDocument = async () => {
    try {
      if (!documentId) {
        setStatusMessage('❌ No document to delete.');
        return;
      }

      if (!window.confirm('Are you sure you want to delete this document?')) {
        return;
      }

      setLoading(true);
      setStatusMessage('Deleting document...');

      await axios.delete(
        `${API_BASE}/signed-documents/${documentId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      setDocumentId(null);
      setBase64PDF(null);
      setSignatureBase64(null);
      setStatusMessage('✅ Document deleted successfully!');
    } catch (error) {
      setStatusMessage(`❌ Error: ${error.response?.data?.error || error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // ============================================
  // COMPONENT RENDER
  // ============================================
  return (
    <div style={styles.container}>
      <h1>📄 Document Generation & Signature System</h1>

      {/* Status Messages */}
      <div style={styles.statusBox}>
        <p style={{ whiteSpace: 'pre-wrap', color: '#333' }}>{statusMessage}</p>
      </div>

      {/* Section 1: Generate Document */}
      <div style={styles.section}>
        <h2>Step 1️⃣: Generate Document</h2>
        <button 
          onClick={generateDocument} 
          disabled={loading}
          style={styles.button}
        >
          {loading ? '⏳ Generating...' : '📄 Generate PDF Document'}
        </button>
      </div>

      {/* Section 2: View PDF */}
      {base64PDF && (
        <div style={styles.section}>
          <h2>Step 2️⃣: View Document</h2>
          <div style={styles.pdfContainer}>
            <iframe
              id="pdf-viewer"
              style={styles.iframe}
              title="PDF Viewer"
            />
          </div>
          <button 
            onClick={() => displayPDF(base64PDF)}
            style={styles.button}
          >
            🖥️ Open in New Window
          </button>
          <button 
            onClick={() => downloadPDF(base64PDF)}
            style={Object.assign({}, styles.button, { marginLeft: '10px' })}
          >
            💾 Download PDF
          </button>
        </div>
      )}

      {/* Section 3: Signature Canvas */}
      <div style={styles.section}>
        <h2>Step 3️⃣: Draw Signature</h2>
        <p>Draw your signature in the box below:</p>
        <canvas
          ref={canvasRef}
          width={400}
          height={150}
          style={styles.canvas}
          onMouseDown={(e) => {
            const canvas = canvasRef.current;
            const ctx = canvas.getContext('2d');
            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            ctx.beginPath();
            ctx.moveTo(x, y);
          }}
          onMouseMove={(e) => {
            if (e.buttons === 1) {
              const canvas = canvasRef.current;
              const ctx = canvas.getContext('2d');
              const rect = canvas.getBoundingClientRect();
              const x = e.clientX - rect.left;
              const y = e.clientY - rect.top;
              ctx.lineWidth = 2;
              ctx.lineCap = 'round';
              ctx.lineJoin = 'round';
              ctx.lineTo(x, y);
              ctx.stroke();
            }
          }}
        />
        <br/>
        <button 
          onClick={() => {
            const canvas = canvasRef.current;
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            setSignatureBase64(null);
            setStatusMessage('Canvas cleared');
          }}
          style={styles.button}
        >
          🗑️ Clear Signature
        </button>
        <button 
          onClick={() => captureSignature(canvasRef.current)}
          style={Object.assign({}, styles.button, { marginLeft: '10px' })}
        >
          ✅ Capture Signature
        </button>
      </div>

      {/* Section 4: Sign Document */}
      {signatureBase64 && (
        <div style={styles.section}>
          <h2>Step 4️⃣: Upload Signature & Sign Document</h2>
          <input
            type="text"
            placeholder="Enter your full name"
            id="signer-name"
            style={styles.input}
          />
          <button 
            onClick={() => {
              const name = document.getElementById('signer-name').value;
              if (!name.trim()) {
                alert('Please enter your name');
                return;
              }
              signDocument(name);
            }}
            disabled={loading}
            style={styles.button}
          >
            {loading ? '⏳ Signing...' : '🖋️ Sign Document'}
          </button>
        </div>
      )}

      {/* Section 5: Document Management */}
      {documentId && (
        <div style={styles.section}>
          <h2>Step 5️⃣: Document Management</h2>
          <p style={styles.infoText}>Document ID: {documentId}</p>
          <button 
            onClick={retrieveDocument}
            disabled={loading}
            style={styles.button}
          >
            🔄 Retrieve Document
          </button>
          <button 
            onClick={getApplicationDocuments}
            disabled={loading}
            style={Object.assign({}, styles.button, { marginLeft: '10px' })}
          >
            📋 View All Application Documents
          </button>
          <button 
            onClick={deleteDocument}
            disabled={loading}
            style={Object.assign({}, styles.button, { marginLeft: '10px', backgroundColor: '#dc3545' })}
          >
            🗑️ Delete Document
          </button>
        </div>
      )}

      {/* Complete Workflow Diagram */}
      <div style={styles.section}>
        <h2>📊 Complete Workflow</h2>
        <pre style={styles.diagram}>{`
1. Generate PDF from template
   ↓
2. View PDF in browser
   ↓
3. Download PDF (optional)
   ↓
4. Physical signature on document
   ↓
5. Scan/photo of signature
   ↓
6. Draw signature in canvas (or upload image)
   ↓
7. Upload signature image
   ↓
8. Signature stamped on PDF
   ↓
9. Download signed PDF
   ↓
✅ Document signed and stored
        `}</pre>
      </div>
    </div>
  );
};

// ============================================
// STYLING
// ============================================
const styles = {
  container: {
    maxWidth: '900px',
    margin: '20px auto',
    padding: '20px',
    fontFamily: 'Arial, sans-serif',
    backgroundColor: '#f5f5f5',
    borderRadius: '8px'
  },
  section: {
    backgroundColor: 'white',
    padding: '20px',
    marginBottom: '20px',
    borderRadius: '6px',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
  },
  button: {
    backgroundColor: '#007bff',
    color: 'white',
    border: 'none',
    padding: '10px 20px',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 'bold',
    transition: 'background-color 0.3s'
  },
  input: {
    width: '100%',
    padding: '10px',
    marginBottom: '10px',
    border: '1px solid #ccc',
    borderRadius: '4px',
    fontSize: '14px'
  },
  canvas: {
    border: '2px solid #ddd',
    borderRadius: '4px',
    backgroundColor: '#fafafa',
    cursor: 'crosshair',
    marginBottom: '10px',
    display: 'block'
  },
  pdfContainer: {
    marginBottom: '10px'
  },
  iframe: {
    width: '100%',
    height: '600px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    marginBottom: '10px'
  },
  statusBox: {
    backgroundColor: '#e7f3ff',
    border: '1px solid #b3d9ff',
    padding: '15px',
    borderRadius: '4px',
    marginBottom: '20px',
    minHeight: '60px'
  },
  infoText: {
    backgroundColor: '#f0f0f0',
    padding: '10px',
    borderRadius: '4px',
    marginBottom: '10px',
    fontFamily: 'monospace'
  },
  diagram: {
    backgroundColor: '#f0f0f0',
    padding: '15px',
    borderRadius: '4px',
    overflow: 'auto'
  }
};

export default DocumentSignatureComponent;
