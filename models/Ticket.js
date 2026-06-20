import mongoose from 'mongoose';

const messageSubSchema = new mongoose.Schema(
  {
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    senderRole: {
      type: String,
      enum: ['user', 'support', 'superadmin'],
      required: true,
    },
    text: {
      type: String,
      required: [true, 'Message text is required'],
      maxlength: [4000, 'Message cannot exceed 4000 characters'],
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const ticketSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User is required'],
      index: true,
    },
    subject: {
      type: String,
      required: [true, 'Subject is required'],
      trim: true,
      maxlength: [200, 'Subject cannot exceed 200 characters'],
    },
    status: {
      type: String,
      enum: {
        values: ['open', 'answered', 'closed'],
        message: '{VALUE} is not a valid ticket status',
      },
      default: 'open',
      index: true,
    },
    messages: [messageSubSchema],
  },
  { timestamps: true }
);

ticketSchema.index({ userId: 1, status: 1 });

export default mongoose.model('Ticket', ticketSchema);
