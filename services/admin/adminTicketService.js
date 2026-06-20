import mongoose from 'mongoose';
import { Ticket } from '../../models/index.js';
import { NotFoundError } from '../../utils/errors.js';

class AdminTicketService {
  async getAllTickets(filter = {}) {
    const query = {};
    if (filter.status) query.status = filter.status;
    if (filter.userId) query.userId = filter.userId;
    if (filter.tag) query.tags = filter.tag;

    return Ticket.find(query)
      .populate('userId', 'telegramId')
      .sort({ updatedAt: -1 })
      .lean();
  }

  async getTicketById(ticketId) {
    const ticket = await Ticket.findById(ticketId)
      .populate('userId', 'telegramId')
      .lean();
    if (!ticket) throw new NotFoundError('Ticket');
    return ticket;
  }

  async replyToTicket(ticketId, adminId, adminRole, text) {
    const ticket = await Ticket.findById(ticketId);
    if (!ticket) throw new NotFoundError('Ticket');

    ticket.messages.push({
      senderId: adminId,
      senderRole: adminRole,
      text,
    });
    ticket.status = 'answered';
    return ticket.save();
  }

  async closeTicket(ticketId) {
    const ticket = await Ticket.findByIdAndUpdate(
      ticketId,
      { $set: { status: 'closed' } },
      { new: true },
    );
    if (!ticket) throw new NotFoundError('Ticket');
    return ticket;
  }

  async reopenTicket(ticketId) {
    const ticket = await Ticket.findByIdAndUpdate(
      ticketId,
      { $set: { status: 'open' } },
      { new: true },
    );
    if (!ticket) throw new NotFoundError('Ticket');
    return ticket;
  }
}

export default new AdminTicketService();
