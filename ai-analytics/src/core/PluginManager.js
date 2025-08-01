const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');
const EventBus = require('./EventBus');

class PluginManager {
  constructor() {
    this.plugins = new Map();
    this.pluginConfigs = new Map();
    this.eventBus = new EventBus();
    this.pluginDirectory = path.join(__dirname, '../../plugins');
  }

  /**
   * Load a plugin by name
   * @param {string} pluginName - Name of the plugin to load
   * @param {Object} config - Plugin configuration
   */
  async loadPlugin(pluginName, config = {}) {
    try {
      const pluginPath = path.join(this.pluginDirectory, pluginName);
      
      // Check if plugin directory exists
      try {
        await fs.access(pluginPath);
      } catch (error) {
        throw new Error(`Plugin directory not found: ${pluginPath}`);
      }

      // Load plugin manifest
      const manifestPath = path.join(pluginPath, 'manifest.json');
      let manifest;
      
      try {
        const manifestData = await fs.readFile(manifestPath, 'utf8');
        manifest = JSON.parse(manifestData);
      } catch (error) {
        throw new Error(`Invalid or missing manifest.json for plugin: ${pluginName}`);
      }

      // Validate manifest
      this.validateManifest(manifest);

      // Load plugin code
      const pluginEntryPath = path.join(pluginPath, manifest.main || 'index.js');
      const PluginClass = require(pluginEntryPath);

      // Instantiate plugin
      const pluginInstance = new PluginClass({
        name: pluginName,
        config: { ...manifest.config, ...config },
        eventBus: this.eventBus,
        logger: logger.child({ plugin: pluginName })
      });

      // Validate plugin interface
      this.validatePluginInterface(pluginInstance, manifest);

      // Initialize plugin
      if (typeof pluginInstance.initialize === 'function') {
        await pluginInstance.initialize();
      }

      // Store plugin
      this.plugins.set(pluginName, {
        instance: pluginInstance,
        manifest,
        loadedAt: new Date(),
        status: 'active'
      });

      this.pluginConfigs.set(pluginName, manifest.config);

      logger.info(`Plugin loaded successfully: ${pluginName}`, {
        version: manifest.version,
        description: manifest.description
      });

      // Emit plugin loaded event
      this.eventBus.emit('plugin:loaded', {
        name: pluginName,
        manifest,
        instance: pluginInstance
      });

      return pluginInstance;

    } catch (error) {
      logger.error(`Failed to load plugin ${pluginName}:`, error);
      throw error;
    }
  }

  /**
   * Load all plugins from a directory
   * @param {string} directory - Directory containing plugins
   */
  async loadPluginsFromDirectory(directory = this.pluginDirectory) {
    try {
      const entries = await fs.readdir(directory, { withFileTypes: true });
      const pluginDirs = entries.filter(entry => entry.isDirectory());

      const loadPromises = pluginDirs.map(dir => 
        this.loadPlugin(dir.name).catch(error => {
          logger.warn(`Skipping plugin ${dir.name}:`, error.message);
        })
      );

      await Promise.all(loadPromises);
      
      logger.info(`Loaded ${this.plugins.size} plugins from ${directory}`);
    } catch (error) {
      logger.error(`Failed to load plugins from directory ${directory}:`, error);
    }
  }

  /**
   * Unload a plugin
   * @param {string} pluginName - Name of the plugin to unload
   */
  async unloadPlugin(pluginName) {
    const plugin = this.plugins.get(pluginName);
    
    if (!plugin) {
      throw new Error(`Plugin not found: ${pluginName}`);
    }

    try {
      // Call plugin cleanup if available
      if (typeof plugin.instance.destroy === 'function') {
        await plugin.instance.destroy();
      }

      // Remove from plugins map
      this.plugins.delete(pluginName);
      this.pluginConfigs.delete(pluginName);

      logger.info(`Plugin unloaded: ${pluginName}`);

      // Emit plugin unloaded event
      this.eventBus.emit('plugin:unloaded', {
        name: pluginName
      });

    } catch (error) {
      logger.error(`Error unloading plugin ${pluginName}:`, error);
      throw error;
    }
  }

  /**
   * Unload all plugins
   */
  async unloadAllPlugins() {
    const pluginNames = Array.from(this.plugins.keys());
    
    for (const pluginName of pluginNames) {
      try {
        await this.unloadPlugin(pluginName);
      } catch (error) {
        logger.error(`Error unloading plugin ${pluginName}:`, error);
      }
    }
  }

  /**
   * Get a plugin instance
   * @param {string} pluginName - Name of the plugin
   */
  getPlugin(pluginName) {
    const plugin = this.plugins.get(pluginName);
    return plugin ? plugin.instance : null;
  }

  /**
   * Get all loaded plugins
   */
  getLoadedPlugins() {
    return Array.from(this.plugins.entries()).map(([name, plugin]) => ({
      name,
      manifest: plugin.manifest,
      status: plugin.status,
      loadedAt: plugin.loadedAt
    }));
  }

  /**
   * Get plugin configuration
   * @param {string} pluginName - Name of the plugin
   */
  getPluginConfig(pluginName) {
    return this.pluginConfigs.get(pluginName);
  }

  /**
   * Update plugin configuration
   * @param {string} pluginName - Name of the plugin
   * @param {Object} config - New configuration
   */
  async updatePluginConfig(pluginName, config) {
    const plugin = this.plugins.get(pluginName);
    
    if (!plugin) {
      throw new Error(`Plugin not found: ${pluginName}`);
    }

    try {
      // Update plugin configuration
      if (typeof plugin.instance.updateConfig === 'function') {
        await plugin.instance.updateConfig(config);
      }

      this.pluginConfigs.set(pluginName, { ...this.pluginConfigs.get(pluginName), ...config });

      logger.info(`Plugin configuration updated: ${pluginName}`);

      // Emit configuration updated event
      this.eventBus.emit('plugin:config:updated', {
        name: pluginName,
        config
      });

    } catch (error) {
      logger.error(`Error updating plugin config ${pluginName}:`, error);
      throw error;
    }
  }

  /**
   * Validate plugin manifest
   * @param {Object} manifest - Plugin manifest
   */
  validateManifest(manifest) {
    const requiredFields = ['name', 'version', 'description', 'main'];
    
    for (const field of requiredFields) {
      if (!manifest[field]) {
        throw new Error(`Missing required field in manifest: ${field}`);
      }
    }

    // Validate version format
    if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) {
      throw new Error('Invalid version format. Expected: x.y.z');
    }
  }

  /**
   * Validate plugin interface
   * @param {Object} pluginInstance - Plugin instance
   * @param {Object} manifest - Plugin manifest
   */
  validatePluginInterface(pluginInstance, manifest) {
    // Check required methods based on plugin type
    const requiredMethods = manifest.type === 'analytics' ? 
      ['process', 'getMetrics'] : 
      ['execute'];

    for (const method of requiredMethods) {
      if (typeof pluginInstance[method] !== 'function') {
        throw new Error(`Plugin missing required method: ${method}`);
      }
    }
  }

  /**
   * Get plugin health status
   */
  async getPluginHealth() {
    const health = {};

    for (const [name, plugin] of this.plugins.entries()) {
      try {
        if (typeof plugin.instance.getHealth === 'function') {
          health[name] = await plugin.instance.getHealth();
        } else {
          health[name] = { status: 'healthy', message: 'No health check available' };
        }
      } catch (error) {
        health[name] = { status: 'unhealthy', error: error.message };
      }
    }

    return health;
  }

  /**
   * Execute method on all plugins of a specific type
   * @param {string} type - Plugin type
   * @param {string} method - Method to execute
   * @param {...any} args - Arguments to pass to the method
   */
  async executeOnPlugins(type, method, ...args) {
    const results = [];

    for (const [name, plugin] of this.plugins.entries()) {
      if (plugin.manifest.type === type && typeof plugin.instance[method] === 'function') {
        try {
          const result = await plugin.instance[method](...args);
          results.push({ plugin: name, result });
        } catch (error) {
          logger.error(`Error executing ${method} on plugin ${name}:`, error);
          results.push({ plugin: name, error: error.message });
        }
      }
    }

    return results;
  }

  /**
   * Get plugin metrics
   */
  async getPluginMetrics() {
    const metrics = {
      totalPlugins: this.plugins.size,
      activePlugins: 0,
      pluginTypes: {},
      pluginHealth: await this.getPluginHealth()
    };

    for (const [name, plugin] of this.plugins.entries()) {
      if (plugin.status === 'active') {
        metrics.activePlugins++;
      }

      const type = plugin.manifest.type || 'unknown';
      metrics.pluginTypes[type] = (metrics.pluginTypes[type] || 0) + 1;
    }

    return metrics;
  }
}

module.exports = PluginManager;