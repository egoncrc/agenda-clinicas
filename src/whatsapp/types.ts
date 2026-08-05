/** Forma del payload que YCloud envía al webhook configurado. */
export interface YCloudInboundEvent {
  id: string;
  type: string;
  apiVersion: string;
  createTime: string;
  whatsappInboundMessage?: {
    id: string;
    wabaId: string;
    from: string;
    to: string;
    sendTime: string;
    type: string;
    text?: { body: string };
    customerProfile?: { name?: string; username?: string };
  };
}
