class Container {
  constructor() {
    this._registry = new Map();
    this._instances = new Map();
  }

  register(name, factory, singleton = true) {
    this._registry.set(name, { factory, singleton });
    this._instances.delete(name);
    return this;
  }

  resolve(name) {
    const entry = this._registry.get(name);
    if (!entry) {
      throw new Error(`Service "${name}" is not registered in the container`);
    }
    if (entry.singleton) {
      if (!this._instances.has(name)) {
        this._instances.set(name, entry.factory(this));
      }
      return this._instances.get(name);
    }
    return entry.factory(this);
  }

  get isReady() {
    return this._registry.size > 0;
  }
}

const container = new Container();

export default container;
