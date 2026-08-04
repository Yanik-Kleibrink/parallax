/**
 * This is the model for the storage of a base location.
 */
export interface Base {
  name: string;
  group: string;
  lastConnected: number;
  domain: string;
  port: number;
  tls: boolean;
  configHash: number;
}
