export default class BaseRepository {
  constructor(model) {
    this.model = model;
  }

  async findById(id, options = {}) {
    const query = this.model.findById(id);
    if (options.populate) query.populate(options.populate);
    const doc = options.session ? await query.session(options.session) : await query;
    return doc || null;
  }

  async findOne(filter, options = {}) {
    const query = this.model.findOne(filter);
    if (options.populate) query.populate(options.populate);
    if (options.sort) query.sort(options.sort);
    const doc = options.session ? await query.session(options.session) : await query;
    return doc || null;
  }

  async findMany(filter, options = {}) {
    let query = this.model.find(filter);
    if (options.populate) query.populate(options.populate);
    if (options.sort) query.sort(options.sort);
    if (options.skip) query.skip(options.skip);
    if (options.limit) query.limit(options.limit);
    if (options.session) query = query.session(options.session);
    return query.lean();
  }

  async count(filter = {}) {
    return this.model.countDocuments(filter);
  }

  async create(data, options = {}) {
    const docs = options.session
      ? await this.model.create([data], { session: options.session })
      : await this.model.create([data]);
    return docs[0];
  }

  async updateById(id, updates, options = {}) {
    const query = this.model.findByIdAndUpdate(id, updates, { new: true, ...options });
    if (options.session) query.session(options.session);
    return query;
  }

  async updateOne(filter, updates, options = {}) {
    return this.model.findOneAndUpdate(filter, updates, { new: true, ...options });
  }

  async updateMany(filter, updates, options = {}) {
    const q = this.model.updateMany(filter, updates);
    if (options.session) q.session(options.session);
    return q;
  }

  async deleteById(id, options = {}) {
    return this.model.findByIdAndDelete(id, options);
  }

  async deleteMany(filter, options = {}) {
    const q = this.model.deleteMany(filter);
    if (options.session) q.session(options.session);
    return q;
  }

  async aggregate(pipeline, options = {}) {
    const q = this.model.aggregate(pipeline);
    if (options.session) q.session(options.session);
    return q;
  }

  async distinct(field, filter = {}) {
    return this.model.distinct(field, filter);
  }

  async exists(filter) {
    return this.model.exists(filter);
  }
}
