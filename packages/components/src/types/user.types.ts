export enum UserRole {
    Owner = 'owner',
    Admin = 'admin',
    User = 'user',
}

export interface User {
    name: string;
    email: string;
    roles: UserRole[];
}