import mongoose from 'mongoose';

const ticketSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  subject: { type: String, required: true },
  message: { type: String, required: true },
  status: { type: String, enum: ['open', 'in_progress', 'closed'], default: 'open', index: true },
  priority: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
  replies: [{
    message: String,
    adminId: mongoose.Schema.Types.ObjectId,
    createdAt: { type: Date, default: Date.now },
  }],
  createdAt: { type: Date, default: Date.now, index: true },
  updatedAt: { type: Date, default: Date.now },
});

export default mongoose.model('Ticket', ticketSchema);
