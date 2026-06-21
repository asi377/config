import AdminTicketService from '../../services/admin/AdminTicketService.js';

export async function getAllTickets(req, res, next) {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.userId) filter.userId = req.query.userId;
    const tickets = await AdminTicketService.getAllTickets(filter);
    res.json({ success: true, data: tickets });
  } catch (err) {
    next(err);
  }
}

export async function getTicket(req, res, next) {
  try {
    const ticket = await AdminTicketService.getTicketById(req.params.id);
    res.json({ success: true, data: ticket });
  } catch (err) {
    next(err);
  }
}

export async function replyToTicket(req, res, next) {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ success: false, error: 'text is required' });
    const ticket = await AdminTicketService.replyToTicket(req.params.id, req.adminId, req.adminRole, text);
    res.json({ success: true, data: ticket });
  } catch (err) {
    next(err);
  }
}

export async function closeTicket(req, res, next) {
  try {
    const ticket = await AdminTicketService.closeTicket(req.params.id);
    res.json({ success: true, data: ticket });
  } catch (err) {
    next(err);
  }
}

export async function reopenTicket(req, res, next) {
  try {
    const ticket = await AdminTicketService.reopenTicket(req.params.id);
    res.json({ success: true, data: ticket });
  } catch (err) {
    next(err);
  }
}
