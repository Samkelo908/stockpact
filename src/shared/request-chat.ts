export interface RequestMessage {
  id: string;
  authorCompanyId: string;
  authorName: string;
  body: string;
  createdAt: string;
  legacy?: boolean;
}

export interface RequestConversation {
  supplierId: string;
  messages: RequestMessage[];
  hasEarlier: boolean;
}

export const requestMessageLimit = 1500;
