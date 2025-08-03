export function encryptSensitiveData(data) {
  const encrypted = { ...data };
  
  // Simple encryption simulation
  Object.keys(encrypted).forEach(key => {
    if (typeof encrypted[key] === 'string' && key.includes('email')) {
      encrypted[key] = `encrypted_${encrypted[key]}`;
    } else if (typeof encrypted[key] === 'string' && key.includes('api_key')) {
      encrypted[key] = `***${encrypted[key].slice(-4)}`;
    }
  });
  
  return encrypted;
}

export function decryptSensitiveData(data) {
  const decrypted = { ...data };
  
  // Simple decryption simulation
  Object.keys(decrypted).forEach(key => {
    if (typeof decrypted[key] === 'string' && decrypted[key].startsWith('encrypted_')) {
      decrypted[key] = decrypted[key].replace('encrypted_', '');
    } else if (typeof decrypted[key] === 'string' && decrypted[key].startsWith('***')) {
      decrypted[key] = `sk-${decrypted[key].slice(3)}`;
    }
  });
  
  return decrypted;
}

export function authorizeMetricAccess(user, metric) {
  if (!user || !metric) return false;
  
  const userRole = user.role || 'guest';
  const classification = metric.classification || 'public';
  
  const permissions = {
    admin: ['public', 'internal', 'confidential', 'restricted'],
    manager: ['public', 'internal', 'confidential'],
    analyst: ['public', 'internal'],
    guest: ['public']
  };
  
  return permissions[userRole]?.includes(classification) || false;
}

export function authorizeEventAccess(user, event) {
  return authorizeMetricAccess(user, event);
}