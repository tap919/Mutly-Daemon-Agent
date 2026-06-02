import { ApprovalRequest } from "../audit/auditTypes.js";

class ApprovalStore {
  private requests: Map<string, ApprovalRequest> = new Map();

  async addRequest(request: ApprovalRequest): Promise<void> {
    this.requests.set(request.id, request);
  }

  async getRequest(id: string): Promise<ApprovalRequest | undefined> {
    return this.requests.get(id);
  }

  async listRequests(): Promise<ApprovalRequest[]> {
    return Array.from(this.requests.values());
  }

  async checkExpiries(): Promise<void> {
    const now = new Date();
    for (const [id, request] of this.requests.entries()) {
      if (new Date(request.expiresAt) < now) {
        this.requests.delete(id);
      }
    }
  }

   async resolveRequest(id: string, decision: 'approved' | 'rejected'): Promise<void> {
     const request = this.requests.get(id);
     if (request) {
       // In a real system, we'd log this decision to the audit log
       this.requests.delete(id); 
     }
   }
}

export const approvalStore = new ApprovalStore();
