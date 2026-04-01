/**
 * Consolidated Notifications & Production API
 * Routes via `action` body parameter:
 *   action=partner           → notify production partner of new order
 *   action=production-status → notify admin of production status change
 *   action=nest              → sheet metal 2D nesting engine (POST with files[] + metadata)
 */

import { Resend } from 'resend';
import { nestOrder, NestingError } from '../lib/nesting/index.js';
import { handleInventoryAction } from '../lib/inventory/index.js';

const resend = new Resend(process.env.RESEND_API_KEY);

function setCors(res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');
}

function formatDate(dateString) {
  return new Date(dateString).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

// ─── Partner notification ───
async function handlePartner(req, res) {
  const { partnerEmail, partnerName, orderId, orderTitle, startDate, deliveryDate, orderItems, totalAmount, currency } = req.body;

  if (!partnerEmail || !partnerName || !orderId || !orderTitle || !startDate || !deliveryDate) {
    return res.status(400).json({ error: 'Missing required fields: partnerEmail, partnerName, orderId, orderTitle, startDate, deliveryDate are required' });
  }

  const generateOrderItemsHTML = (items) => {
    if (!items || items.length === 0) return '<p style="color: #64748b; font-style: italic;">No items specified</p>';
    return items.map(item => `
      <tr style="border-bottom: 1px solid #e5e7eb;">
        <td style="padding: 12px; border-right: 1px solid #e5e7eb; font-weight: 500; color: #1f2937;">${item.product_name || 'N/A'}</td>
        <td style="padding: 12px; border-right: 1px solid #e5e7eb; color: #6b7280; font-size: 14px;">${item.description || 'No description'}</td>
        <td style="padding: 12px; border-right: 1px solid #e5e7eb; text-align: center; color: #1f2937; font-weight: 500;">${item.quantity || 0}</td>
        <td style="padding: 12px; text-align: center; color: #1f2937; font-weight: 500;">${item.sku || 'N/A'}</td>
      </tr>
    `).join('');
  };

  const partnerEmailResult = await resend.emails.send({
    from: 'MicronsHub Production <info@micronshub.eu>',
    to: [partnerEmail],
    subject: `New Production Order Received - ${orderTitle}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 700px; margin: 0 auto; padding: 20px;">
        <div style="background: #f0f9ff; border: 2px solid #0ea5e9; padding: 25px; border-radius: 12px; margin: 20px 0;">
          <h2 style="color: #0c4a6e; font-size: 24px; margin: 0 0 20px 0;">🏭 New Production Order Received</h2>
          <p style="color: #0c4a6e; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">Dear ${partnerName},</p>
          <p style="color: #0c4a6e; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">We are pleased to assign a new production order to your company. Please review the details below and confirm your acceptance.</p>
        </div>
        <div style="background: #f8fafc; padding: 25px; border-radius: 12px; margin: 20px 0;">
          <h3 style="color: #1e293b; font-size: 20px; margin: 0 0 20px 0;">Order Information</h3>
          <div style="background: white; padding: 15px; border-radius: 8px; border: 1px solid #e2e8f0; margin-bottom: 20px;">
            <p style="color: #374151; font-size: 14px; margin: 0 0 5px 0; font-weight: bold;">Order Title</p>
            <p style="color: #1f2937; font-size: 16px; margin: 0;">${orderTitle}</p>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px;">
            <div style="background: #ecfdf5; padding: 15px; border-radius: 8px; border: 1px solid #a7f3d0;">
              <p style="color: #065f46; font-size: 14px; margin: 0 0 5px 0; font-weight: bold;">📅 Production Start Date</p>
              <p style="color: #047857; font-size: 16px; margin: 0; font-weight: 500;">${formatDate(startDate)}</p>
            </div>
            <div style="background: #fef3c7; padding: 15px; border-radius: 8px; border: 1px solid #fde68a;">
              <p style="color: #92400e; font-size: 14px; margin: 0 0 5px 0; font-weight: bold;">🚚 Delivery Date</p>
              <p style="color: #b45309; font-size: 16px; margin: 0; font-weight: 500;">${formatDate(deliveryDate)}</p>
            </div>
          </div>
        </div>
        <div style="background: #f8fafc; padding: 25px; border-radius: 12px; margin: 20px 0;">
          <h3 style="color: #1e293b; font-size: 20px; margin: 0 0 20px 0;">Production Items</h3>
          <div style="overflow-x: auto;">
            <table style="width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);">
              <thead>
                <tr style="background: #f8fafc;">
                  <th style="padding: 12px; text-align: left; font-weight: 600; color: #374151; border-bottom: 2px solid #e5e7eb;">Product Name</th>
                  <th style="padding: 12px; text-align: left; font-weight: 600; color: #374151; border-bottom: 2px solid #e5e7eb;">Description</th>
                  <th style="padding: 12px; text-align: center; font-weight: 600; color: #374151; border-bottom: 2px solid #e5e7eb;">Quantity</th>
                  <th style="padding: 12px; text-align: center; font-weight: 600; color: #374151; border-bottom: 2px solid #e5e7eb;">SKU</th>
                </tr>
              </thead>
              <tbody>${generateOrderItemsHTML(orderItems)}</tbody>
            </table>
          </div>
        </div>
        <div style="background: #f0f9ff; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h4 style="color: #1e40af; font-size: 16px; margin: 0 0 10px 0;">📋 Next Steps</h4>
          <ul style="color: #1e40af; font-size: 14px; margin: 0; padding-left: 20px;">
            <li>Review the order details and production requirements</li>
            <li>Confirm your acceptance and production timeline</li>
            <li>Access the order in your partner dashboard for detailed specifications</li>
            <li>Contact us if you have any questions or concerns</li>
          </ul>
        </div>
        <div style="text-align: center; margin: 30px 0; padding: 20px; background: #f1f5f9; border-radius: 8px;">
          <p style="color: #1e293b; font-size: 16px; margin: 0 0 10px 0;"><strong>Best regards,</strong></p>
          <p style="color: #1e293b; font-size: 16px; margin: 0;">Microns Hubs Production Team</p>
          <p style="color: #64748b; font-size: 14px; margin: 10px 0 0 0;">📧 info@micronshub.eu | 📞 +302104447830</p>
        </div>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 30px 0;">
        <p style="color: #64748b; font-size: 12px; text-align: center; margin: 0;">This email was sent from the Microns Hubs production management system at ${new Date().toLocaleString()}</p>
      </div>
    `,
  });

  return res.status(200).json({ success: true, partnerEmail: partnerEmailResult, message: 'Partner notification email sent successfully' });
}

// ─── Sheet metal nesting ───
async function handleNest(req, res) {
  try {
    const { files, metadata } = req.body || {};

    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Missing or empty "files" array. Provide DXF file contents as strings.',
      });
    }

    if (!metadata || !metadata.parts || !Array.isArray(metadata.parts) || metadata.parts.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Missing or empty "metadata.parts" array.',
      });
    }

    for (const part of metadata.parts) {
      if (part.fileIndex === undefined || part.fileIndex < 0 || part.fileIndex >= files.length) {
        return res.status(400).json({
          success: false,
          error: `Invalid fileIndex ${part.fileIndex} for part "${part.name}".`,
        });
      }
      if (!part.material) {
        return res.status(400).json({ success: false, error: `Missing "material" for part "${part.name}".` });
      }
      if (!part.thickness || part.thickness <= 0) {
        return res.status(400).json({ success: false, error: `Invalid "thickness" for part "${part.name}".` });
      }
    }

    const result = await nestOrder(files, metadata);
    return res.status(200).json(result);
  } catch (err) {
    if (err instanceof NestingError) {
      const statusMap = { INVALID_DXF: 400, NO_CLOSED_CONTOURS: 400, PART_TOO_LARGE: 400, EMPTY_ORDER: 400, INVALID_METADATA: 400, TIMEOUT: 504 };
      return res.status(statusMap[err.code] || 500).json({ success: false, error: err.message, code: err.code, details: err.details });
    }
    console.error('Nesting error:', err);
    return res.status(500).json({ success: false, error: 'Internal server error during nesting.' });
  }
}

// ─── Production status notification ───
async function handleProductionStatus(req, res) {
  const { partnerName, orderId, orderTitle, status, startDate, deliveryDate, totalAmount, currency } = req.body;

  if (!partnerName || !orderId || !orderTitle || !status) {
    return res.status(400).json({ error: 'Missing required fields: partnerName, orderId, orderTitle, status are required' });
  }

  const isStarted = status === 'started';
  const statusText = isStarted ? 'Production Started' : 'Production Finished';
  const statusIcon = isStarted ? '🏭' : '✅';
  const statusColor = isStarted ? '#0ea5e9' : '#10b981';
  const statusBgColor = isStarted ? '#f0f9ff' : '#f0fdf4';
  const statusBorderColor = isStarted ? '#0ea5e9' : '#10b981';

  const adminEmailResult = await resend.emails.send({
    from: 'MicronsHub Production <info@micronshub.eu>',
    to: ['dimitrisvard@hotmail.com', 'info@micronshub.eu'],
    subject: `${statusIcon} ${statusText} - ${orderTitle} by ${partnerName}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 700px; margin: 0 auto; padding: 20px;">
        <div style="background: ${statusBgColor}; border: 2px solid ${statusBorderColor}; padding: 25px; border-radius: 12px; margin: 20px 0;">
          <h2 style="color: ${statusColor}; font-size: 24px; margin: 0 0 20px 0;">${statusIcon} ${statusText}</h2>
          <p style="color: ${statusColor}; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
            ${isStarted ? `Production has been started by ${partnerName} for order ${orderTitle}.` : `Production has been completed by ${partnerName} for order ${orderTitle}.`}
          </p>
        </div>
        <div style="background: #f8fafc; padding: 25px; border-radius: 12px; margin: 20px 0;">
          <h3 style="color: #1e293b; font-size: 20px; margin: 0 0 20px 0;">Order Information</h3>
          <div style="background: white; padding: 15px; border-radius: 8px; border: 1px solid #e2e8f0; margin-bottom: 20px;">
            <p style="color: #374151; font-size: 14px; margin: 0 0 5px 0; font-weight: bold;">Order Title</p>
            <p style="color: #1f2937; font-size: 16px; margin: 0;">${orderTitle}</p>
          </div>
          <div style="background: white; padding: 15px; border-radius: 8px; border: 1px solid #e2e8f0; margin-bottom: 20px;">
            <p style="color: #374151; font-size: 14px; margin: 0 0 5px 0; font-weight: bold;">Production Partner</p>
            <p style="color: #1f2937; font-size: 16px; margin: 0;">${partnerName}</p>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px;">
            <div style="background: #ecfdf5; padding: 15px; border-radius: 8px; border: 1px solid #a7f3d0;">
              <p style="color: #065f46; font-size: 14px; margin: 0 0 5px 0; font-weight: bold;">📅 Production Start Date</p>
              <p style="color: #047857; font-size: 16px; margin: 0; font-weight: 500;">${formatDate(startDate)}</p>
            </div>
            <div style="background: #fef3c7; padding: 15px; border-radius: 8px; border: 1px solid #fde68a;">
              <p style="color: #92400e; font-size: 14px; margin: 0 0 5px 0; font-weight: bold;">🚚 Delivery Date</p>
              <p style="color: #b45309; font-size: 16px; margin: 0; font-weight: 500;">${formatDate(deliveryDate)}</p>
            </div>
          </div>
          ${totalAmount ? `
          <div style="background: #f0f9ff; padding: 15px; border-radius: 8px; border: 1px solid #bae6fd;">
            <p style="color: #1e40af; font-size: 14px; margin: 0 0 5px 0; font-weight: bold;">💰 Order Value</p>
            <p style="color: #1e40af; font-size: 18px; margin: 0; font-weight: 600;">${totalAmount.toLocaleString()} ${currency}</p>
          </div>
          ` : ''}
        </div>
        <div style="background: ${isStarted ? '#fef3c7' : '#f0fdf4'}; padding: 20px; border-radius: 8px; margin: 20px 0; border: 1px solid ${isStarted ? '#fde68a' : '#bbf7d0'};">
          <h4 style="color: ${isStarted ? '#92400e' : '#065f46'}; font-size: 16px; margin: 0 0 10px 0;">
            ${isStarted ? '🚀 Production Started' : '🎉 Production Completed'}
          </h4>
          <ul style="color: ${isStarted ? '#92400e' : '#065f46'}; font-size: 14px; margin: 0; padding-left: 20px;">
            ${isStarted ? [
              'Production has officially begun',
              'Monitor progress through the dashboard',
              'Expect regular updates from the production partner',
              'Contact partner if you have any questions'
            ].map(item => `<li>${item}</li>`).join('') : [
              'Production has been completed successfully',
              'Order is ready for quality inspection',
              'Prepare for delivery or pickup',
              'Update order status in the system'
            ].map(item => `<li>${item}</li>`).join('')}
          </ul>
        </div>
        <div style="text-align: center; margin: 30px 0; padding: 20px; background: #f1f5f9; border-radius: 8px;">
          <p style="color: #1e293b; font-size: 16px; margin: 0 0 10px 0;"><strong>Best regards,</strong></p>
          <p style="color: #1e293b; font-size: 16px; margin: 0;">Microns Hubs Production Team</p>
          <p style="color: #64748b; font-size: 14px; margin: 10px 0 0 0;">📧 info@micronshub.eu | 📞 +302104447830</p>
        </div>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 30px 0;">
        <p style="color: #64748b; font-size: 12px; text-align: center; margin: 0;">This email was sent from the Microns Hubs production management system at ${new Date().toLocaleString()}</p>
      </div>
    `,
  });

  return res.status(200).json({ success: true, adminEmail: adminEmailResult, message: 'Production status notification email sent successfully' });
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const action = req.body?.action || new URL(req.url, 'http://localhost').searchParams.get('action') || 'partner';

    // Inventory actions (support GET and POST)
    if (action.startsWith('inv-')) {
      return handleInventoryAction(action, req, res);
    }

    // Original actions (POST only)
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    switch (action) {
      case 'nest':
        return handleNest(req, res);
      case 'production-status':
        return handleProductionStatus(req, res);
      case 'partner':
      default:
        return handlePartner(req, res);
    }
  } catch (error) {
    console.error('Notification handler error:', error);
    return res.status(500).json({ error: 'Failed to send notification', details: error.message });
  }
}
