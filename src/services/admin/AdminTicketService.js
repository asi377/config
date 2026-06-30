import BaseService from '../../shared/BaseService.js';
import { NotFoundError } from '../../shared/errors.js';
import TicketRepository from '../../repositories/TicketRepository.js';

class AdminTicketService extends BaseService {
  getAllTickets = this.wrapMethod(async (filter = {}) => {
    const query = {};
    if (filter.status) query.status = filter.status;
    if (filter.userId) query.userId = filter.userId;
    return TicketRepository.findWithUser(query);
  });

  getTicketById = this.wrapMethod(async (ticketId) => {
    const ticket = await TicketRepository.findById(ticketId, { populate: 'userId' });
    if (!ticket) throw new NotFoundError('Ticket');
    return ticket;
  });

  replyToTicket = this.wrapMethod(async (ticketId, adminId, adminRole, text) => {
    const ticket = await TicketRepository.findById(ticketId);
    if (!ticket) throw new NotFoundError('Ticket');
    ticket.messages.push({ senderId: adminId, senderRole: adminRole, text });
    ticket.status = 'answered';
    return ticket.save();
  });

  closeTicket = this.wrapMethod(async (ticketId) => {
    const ticket = await TicketRepository.updateById(ticketId, { $set: { status: 'closed' } });
    if (!ticket) throw new NotFoundError('Ticket');
    return ticket;
  });

  reopenTicket = this.wrapMethod(async (ticketId) => {
    const ticket = await TicketRepository.updateById(ticketId, { $set: { status: 'open' } });
    if (!ticket) throw new NotFoundError('Ticket');
    return ticket;
  });
}

export default new AdminTicketService();
