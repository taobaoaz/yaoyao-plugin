/**
 * utils/claw-bridge-types.ts — Types and error classes for claw-bridge.
 */
export class ClawBridgeError extends Error {
    classification;
    cause;
    constructor(message, classification, cause) {
        super(message);
        this.name = 'ClawBridgeError';
        this.classification = classification;
        this.cause = cause;
    }
}
