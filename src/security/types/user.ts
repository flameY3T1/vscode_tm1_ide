// src/security/types/user.ts
export type UserType = 'User' | 'SecurityAdmin' | 'DataAdmin' | 'OperationsAdmin' | 'Admin';

export interface User {
  name: string;
  type: UserType;
  disabled: boolean;
  lastLogin?: string;
  groups: string[];
}

export interface NewUserInput {
  name: string;
  type: UserType;
  password: string;
  groups: string[];
}
