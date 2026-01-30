// ============================================================================
// Version Service
// ============================================================================
// Tracks application version and deployment timestamp
// Version comes from package.json, deployment time from version.json

import * as fs from "fs";
import * as path from "path";
import { logger } from "../utils/logger";

interface VersionInfo {
  version: string;
  deployedAt: string;
  environment: string;
  uptime: number;
}

class VersionService {
  private version: string = "unknown";
  private deployedAt: string = new Date().toISOString();
  private environment: string = process.env["NODE_ENV"] || "development";
  private startTime: number = Date.now();

  constructor() {
    this.loadVersion();
    this.loadDeploymentInfo();
  }

  /**
   * Load version from package.json
   */
  private loadVersion(): void {
    try {
      const packageJsonPath = path.join(__dirname, "../../package.json");
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
      this.version = packageJson.version || "unknown";
      logger.info("Version loaded from package.json", { version: this.version });
    } catch (error: any) {
      logger.error("Failed to load version from package.json", {
        error: error.message,
      });
    }
  }

  /**
   * Load deployment info from version.json
   * If file doesn't exist, create it with current timestamp
   */
  private loadDeploymentInfo(): void {
    try {
      const versionJsonPath = path.join(__dirname, "../../version.json");

      // Check if version.json exists
      if (fs.existsSync(versionJsonPath)) {
        const versionJson = JSON.parse(fs.readFileSync(versionJsonPath, "utf-8"));
        this.deployedAt = versionJson.deployedAt || new Date().toISOString();
        this.environment = versionJson.environment || this.environment;
        logger.info("Deployment info loaded from version.json", {
          deployedAt: this.deployedAt,
          environment: this.environment,
        });
      } else {
        // Create version.json with current timestamp
        this.createVersionFile();
      }
    } catch (error: any) {
      logger.error("Failed to load deployment info from version.json", {
        error: error.message,
      });
      // Create new version file if loading failed
      this.createVersionFile();
    }
  }

  /**
   * Get current time in EST
   */
  private getCurrentTimeEST(): Date {
    const now = new Date();
    const estOffset = -5 * 60; // EST is UTC-5
    const utc = now.getTime() + now.getTimezoneOffset() * 60000;
    const estTime = new Date(utc + estOffset * 60000);
    return estTime;
  }

  /**
   * Format date as EST ISO string
   */
  private formatEST(date: Date): string {
    return date.toISOString().replace("Z", "") + " EST";
  }

  /**
   * Create version.json file with current timestamp
   */
  private createVersionFile(): void {
    try {
      const versionJsonPath = path.join(__dirname, "../../version.json");
      const estTime = this.getCurrentTimeEST();
      const versionData = {
        version: this.version,
        deployedAt: this.formatEST(estTime),
        environment: this.environment,
        note: "This file is auto-generated. Update deployedAt on each deployment.",
      };

      fs.writeFileSync(versionJsonPath, JSON.stringify(versionData, null, 2), "utf-8");
      this.deployedAt = versionData.deployedAt;

      logger.info("Created version.json", {
        deployedAt: this.deployedAt,
      });
    } catch (error: any) {
      logger.error("Failed to create version.json", {
        error: error.message,
      });
    }
  }

  /**
   * Get current version info
   */
  public getVersionInfo(): VersionInfo {
    const uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000);

    return {
      version: this.version,
      deployedAt: this.deployedAt,
      environment: this.environment,
      uptime: uptimeSeconds,
    };
  }

  /**
   * Update deployment timestamp
   * Call this on deployment/restart to update the timestamp
   */
  public updateDeploymentTimestamp(): void {
    try {
      const versionJsonPath = path.join(__dirname, "../../version.json");
      const estTime = this.getCurrentTimeEST();
      const versionData = {
        version: this.version,
        deployedAt: this.formatEST(estTime),
        environment: this.environment,
        note: "This file is auto-generated. Update deployedAt on each deployment.",
      };

      fs.writeFileSync(versionJsonPath, JSON.stringify(versionData, null, 2), "utf-8");
      this.deployedAt = versionData.deployedAt;

      logger.info("Updated deployment timestamp in version.json", {
        deployedAt: this.deployedAt,
      });
    } catch (error: any) {
      logger.error("Failed to update deployment timestamp", {
        error: error.message,
      });
    }
  }

  /**
   * Get version string
   */
  public getVersion(): string {
    return this.version;
  }

  /**
   * Get deployment timestamp
   */
  public getDeployedAt(): string {
    return this.deployedAt;
  }

  /**
   * Get environment
   */
  public getEnvironment(): string {
    return this.environment;
  }

  /**
   * Get uptime in seconds
   */
  public getUptime(): number {
    return Math.floor((Date.now() - this.startTime) / 1000);
  }
}

// Export singleton instance
export const versionService = new VersionService();
