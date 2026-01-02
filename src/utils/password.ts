/**
 * Secure Password Hashing Utility
 *
 * Uses PBKDF2-SHA256 for password hashing with the Web Crypto API.
 * This is compatible with Netlify Functions/Edge Functions without
 * requiring native dependencies.
 */

// Configuration for PBKDF2
const PBKDF2_ITERATIONS = 600000; // OWASP recommended minimum for SHA-256
const SALT_LENGTH = 32; // 256 bits
const KEY_LENGTH = 32; // 256 bits

/**
 * Generate a cryptographically secure random salt
 */
function generateSalt(): Uint8Array {
    const salt = new Uint8Array(SALT_LENGTH);
    crypto.getRandomValues(salt);
    return salt;
}

/**
 * Convert a Uint8Array to a hex string
 */
function uint8ArrayToHex(array: Uint8Array): string {
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Convert a hex string to Uint8Array
 */
function hexToUint8Array(hex: string): Uint8Array {
    const matches = hex.match(/.{1,2}/g);
    if (!matches) throw new Error('Invalid hex string');
    return new Uint8Array(matches.map(byte => parseInt(byte, 16)));
}

/**
 * Hash a password using PBKDF2-SHA256
 * Returns a string in the format: $pbkdf2-sha256$iterations$salt$hash
 */
export async function hashPassword(password: string): Promise<string> {
    const salt = generateSalt();
    const encoder = new TextEncoder();

    // Import the password as a key
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        encoder.encode(password),
        'PBKDF2',
        false,
        ['deriveBits']
    );

    // Derive the hash
    const derivedBits = await crypto.subtle.deriveBits(
        {
            name: 'PBKDF2',
            salt: salt,
            iterations: PBKDF2_ITERATIONS,
            hash: 'SHA-256'
        },
        keyMaterial,
        KEY_LENGTH * 8 // in bits
    );

    const hash = new Uint8Array(derivedBits);

    // Format: $pbkdf2-sha256$iterations$salt$hash
    return `$pbkdf2-sha256$${PBKDF2_ITERATIONS}$${uint8ArrayToHex(salt)}$${uint8ArrayToHex(hash)}`;
}

/**
 * Verify a password against a stored hash
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
    // Handle legacy plaintext passwords (for migration)
    if (!storedHash.startsWith('$pbkdf2-sha256$')) {
        // This is a plaintext password - direct comparison
        // WARNING: This is only for migration purposes
        return password === storedHash;
    }

    // Parse the stored hash
    const parts = storedHash.split('$');
    if (parts.length !== 5 || parts[1] !== 'pbkdf2-sha256') {
        return false;
    }

    const iterations = parseInt(parts[2], 10);
    const salt = hexToUint8Array(parts[3]);
    const expectedHash = parts[4];

    if (isNaN(iterations) || iterations < 1) {
        return false;
    }

    const encoder = new TextEncoder();

    // Import the password as a key
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        encoder.encode(password),
        'PBKDF2',
        false,
        ['deriveBits']
    );

    // Derive the hash with the same parameters
    const derivedBits = await crypto.subtle.deriveBits(
        {
            name: 'PBKDF2',
            salt: salt,
            iterations: iterations,
            hash: 'SHA-256'
        },
        keyMaterial,
        KEY_LENGTH * 8
    );

    const hash = new Uint8Array(derivedBits);
    const computedHash = uint8ArrayToHex(hash);

    // Constant-time comparison to prevent timing attacks
    if (computedHash.length !== expectedHash.length) {
        return false;
    }

    let result = 0;
    for (let i = 0; i < computedHash.length; i++) {
        result |= computedHash.charCodeAt(i) ^ expectedHash.charCodeAt(i);
    }

    return result === 0;
}

/**
 * Check if a password hash needs to be upgraded (e.g., more iterations)
 */
export function needsRehash(storedHash: string): boolean {
    // Plaintext passwords always need to be hashed
    if (!storedHash.startsWith('$pbkdf2-sha256$')) {
        return true;
    }

    // Check if iterations are current
    const parts = storedHash.split('$');
    if (parts.length !== 5) {
        return true;
    }

    const iterations = parseInt(parts[2], 10);
    return iterations < PBKDF2_ITERATIONS;
}

/**
 * Validate password complexity
 * Returns an array of validation errors (empty if password is valid)
 */
export function validatePasswordComplexity(password: string): string[] {
    const errors: string[] = [];

    if (password.length < 12) {
        errors.push('Password must be at least 12 characters long');
    }

    if (password.length > 128) {
        errors.push('Password must not exceed 128 characters');
    }

    if (!/[a-z]/.test(password)) {
        errors.push('Password must contain at least one lowercase letter');
    }

    if (!/[A-Z]/.test(password)) {
        errors.push('Password must contain at least one uppercase letter');
    }

    if (!/[0-9]/.test(password)) {
        errors.push('Password must contain at least one number');
    }

    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
        errors.push('Password must contain at least one special character');
    }

    // Check for common weak patterns
    const weakPatterns = [
        /^(.)\1+$/, // All same character
        /^(012|123|234|345|456|567|678|789|890)+$/i, // Sequential numbers
        /^(abc|bcd|cde|def|efg|fgh|ghi|hij|ijk|jkl|klm|lmn|mno|nop|opq|pqr|qrs|rst|stu|tuv|uvw|vwx|wxy|xyz)+$/i, // Sequential letters
    ];

    for (const pattern of weakPatterns) {
        if (pattern.test(password)) {
            errors.push('Password contains weak patterns (sequential or repeated characters)');
            break;
        }
    }

    return errors;
}
