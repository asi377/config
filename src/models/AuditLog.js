import mongoose from 'mongoose';

const auditLogSchema = new mongoose.Schema(
  {
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Admin ID is required'],
      index: true,
    },
    action: {
      type: String,
      required: [true, 'Action is required'],
      trim: true,
    },
    targetType: {
      type: String,
      trim: true,
      index: true,
    },
    targetId: {
      type: mongoose.Schema.Types.ObjectId,
    },
    oldValue: {
      type: mongoose.Schema.Types.Mixed,
    },
    newValue: {
      type: mongoose.Schema.Types.Mixed,
    },
    ip: {
      type: String,
    },
  },
  { timestamps: true }
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ adminId: 1, createdAt: -1 });

export default mongoose.model('AuditLog', auditLogSchema);
