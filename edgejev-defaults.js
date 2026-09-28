const DEFAULT_QUESTIONS = {
  reply_mode: {
    type: "choice",
    instructions: "这条消息现在应该如何处理？",
    criteria: {
      reply_now: "需要现在回复",
      reply_later: "可以稍后回复",
      no_reply: "不需要回复"
    }
  },
  intent: {
    type: "choice",
    instructions: "这条消息的主要意图是什么？",
    criteria: {
      question: "询问信息或问题",
      request: "要求对方执行某件事",
      status: "同步状态、进展或事实",
      social: "寒暄、社交或情绪表达",
      complaint: "投诉、不满或负面反馈",
      other: "其他"
    }
  },
  urgency: {
    type: "score",
    instructions: "这条消息的紧急程度",
    criteria: ["不紧急，可以正常处理", "有一定时效性", "很紧急，需要优先处理"]
  },
  negative_emotion: {
    type: "noul",
    instructions: "这条消息是否表达了明显的负面情绪、不满或压力"
  },
  needs_human: {
    type: "noul",
    instructions: "这条消息是否包含高风险、敏感、不可逆或需要人工最终判断的事项"
  }
};

module.exports = { DEFAULT_QUESTIONS };
