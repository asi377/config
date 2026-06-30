export async function getAllTickets(req, res, next) {
  try {
    const Ticket = (await import('../../models/Ticket.js')).default;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const filter = {};
    if (req.query.status) filter.status = req.query.status;

    const [tickets, total] = await Promise.all([
      Ticket.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)
        .populate('userId', 'telegramId')
        .lean(),
      Ticket.countDocuments(filter),
    ]);

    res.json({ success: true, data: { tickets, total, page, pages: Math.ceil(total / limit) } });
  } catch (err) { next(err); }
}

export async function getTicket(req, res, next) {
  try {
    const Ticket = (await import('../../models/Ticket.js')).default;
    const ticket = await Ticket.findById(req.params.id).populate('userId', 'telegramId').lean();
    if (!ticket) return res.status(404).json({ success: false, error: 'Ticket not found' });
    res.json({ success: true, data: ticket });
  } catch (err) { next(err); }
}

export async function replyToTicket(req, res, next) {
  try {
    const Ticket = (await import('../../models/Ticket.js')).default;
    const { reply } = req.body;
    if (!reply) return res.status(400).json({ success: false, error: 'reply is required' });

    const ticket = await Ticket.findByIdAndUpdate(
      req.params.id,
      { $push: { replies: { message: reply, adminId: req.adminId, createdAt: new Date() } } },
      { new: true },
    );
    if (!ticket) return res.status(404).json({ success: false, error: 'Ticket not found' });
    res.json({ success: true, data: ticket });
  } catch (err) { next(err); }
}

export async function closeTicket(req, res, next) {
  try {
    const Ticket = (await import('../../models/Ticket.js')).default;
    const ticket = await Ticket.findByIdAndUpdate(req.params.id, { $set: { status: 'closed' } }, { new: true });
    if (!ticket) return res.status(404).json({ success: false, error: 'Ticket not found' });
    res.json({ success: true, data: ticket });
  } catch (err) { next(err); }
}

export async function reopenTicket(req, res, next) {
  try {
    const Ticket = (await import('../../models/Ticket.js')).default;
    const ticket = await Ticket.findByIdAndUpdate(req.params.id, { $set: { status: 'open' } }, { new: true });
    if (!ticket) return res.status(404).json({ success: false, error: 'Ticket not found' });
    res.json({ success: true, data: ticket });
  } catch (err) { next(err); }
}
