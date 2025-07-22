import { StackAuth } from '@stack-auth/node';

const auth = new StackAuth({
  projectId: process.env.NEXT_PUBLIC_STACK_PROJECT_ID,
  secretKey: process.env.STACK_SECRET_SERVER_KEY,
  publicKey: process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY,
});

export default auth;