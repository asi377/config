import adminTicketService from '../../services/admin/adminTicketService.js';
import { NotFoundError } from '../../utils/errors.js';

export async function getAllTickets(req, res) {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.userId) filter.userId = req.query.userId;
    const tickets = await adminTicketService.getAllTickets(filter);
    res.json({ success: true, data: tickets });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function getTicket(req, res) {
  try {
    const ticket = await adminTicketService.getTicketById(req.params.id);
    res.json({ success: true, data: ticket });
  } catch (err) {
    if (err instanceof NotFoundError) return res.status(404).json({ success: false, error: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function replyToTicket(req, res) {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ success: false, error: 'text is required' });

    const ticket = await adminTicketService.replyToTicket(req.params.id, req.adminId, req.adminRole, text);
    res.json({ success: true, data: ticket });
  } catch (err) {
    if (err instanceof NotFoundError) return res.status(404).json({ success: false, error: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function closeTicket(req, res) {
  try {
    const ticket = await adminTicketService.closeTicket(req.params.id);
    res.json({ success: true, data: ticket });
  } catch (err) {
    if (err instanceof NotFoundError) return res.status(404).json({ success: false, error: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function reopenTicket(req, res) {
  try {
    const ticket = await adminTicketService.reopenTicket(req.params.id);
    res.json({ success: true, data: ticket });
  } catch (err) {
    if (err instanceof NotFoundError) return res.status(404).json({ success: false, error: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
}
