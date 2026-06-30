import mongoose from 'mongoose';

const pendingNodeCommandSchema = new mongoose.Schema(
  {
    serverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Server',
      required: true,
      index: true,
    },
    type: {
      type: String,
      required: true,
      enum: ['create_user', 'remove_user', 'disable_user', 'restart_xray', 'update_config', 'sync_users'],
    },
    params: { type: mongoose.Schema.Types.Mixed, default: {} },
    status: {
      type: String,
      enum: ['pending', 'dispatched', 'completed', 'failed'],
      default: 'pending',
      index: true,
    },
    dispatchedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    error: { type: String, default: null },
  },
  { timestamps: true }
);

pendingNodeCommandSchema.index({ serverId: 1, status: 1 });

export default mongoose.model('PendingNodeCommand', pendingNodeCommandSchema);
