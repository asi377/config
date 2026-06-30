import mongoose from 'mongoose';

const provisionLogSchema = new mongoose.Schema(
  {
    serverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Server',
      default: null,
      index: true,
    },
    action: {
      type: String,
      required: [true, 'Action is required'],
      enum: [
        'server_provisioned', 'agent_installed', 'xray_installed',
        'user_created', 'user_removed', 'user_disabled',
        'config_updated', 'server_rebooted', 'xray_restarted',
        'server_registered', 'server_deregistered',
      ],
      index: true,
    },
    status: {
      type: String,
      enum: ['pending', 'in_progress', 'completed', 'failed'],
      default: 'pending',
      index: true,
    },
    targetEmail: { type: String, default: null },
    targetUuid: { type: String, default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    errorMessage: { type: String, default: null },
    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
    duration: { type: Number, default: 0 },
  },
  { timestamps: true }
);

provisionLogSchema.index({ serverId: 1, createdAt: -1 });
provisionLogSchema.index({ action: 1, status: 1 });

export default mongoose.model('ProvisionLog', provisionLogSchema);
