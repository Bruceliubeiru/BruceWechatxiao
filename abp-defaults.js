const ABP_QUESTIONS = {
  next_step: {
    type: "choice",
    instructions: "对这条输入，下一步最合适的执行方式是什么？",
    criteria: {
      act_now: "可以立刻执行一个明确、可逆的下一步",
      clarify: "缺少会改变行动的关键事实，需要先问一个最小问题",
      schedule: "不必现在执行，更适合进入待办或安排到稍后",
      no_action: "不需要采取行动"
    }
  },
  work_mode: {
    type: "choice",
    instructions: "这条输入主要属于哪种工作模式？",
    criteria: {
      study: "学习、课程、作业、考试",
      admin: "行政、表单、预约、证件、日程",
      communication: "需要回复、沟通、跟进他人",
      research: "需要查证、比较、研究、形成判断",
      coding: "代码、系统、自动化、部署、调试",
      personal: "个人生活、日常安排、自我管理",
      other: "其他"
    }
  },
  urgency: {
    type: "score",
    instructions: "这条输入需要多快处理？",
    criteria: [
      "可以等待，不影响近期结果",
      "今天或近期处理更好",
      "应优先处理，存在明显时效性",
      "现在就应处理，否则可能错过截止期或造成损失"
    ]
  },
  effort: {
    type: "score",
    instructions: "完成下一步需要多大连续注意力？",
    criteria: [
      "两分钟内可完成",
      "约五到二十分钟",
      "需要一段专注时间",
      "需要多步骤计划或较长执行"
    ]
  },
  external_commitment: {
    type: "noul",
    instructions: "下一步是否涉及发送、提交、支付、购买、删除、公开发布、修改安全设置、金融交易、生产破坏性操作或其他外部绑定行为？"
  }
};

function scoreOf(answer) {
  return answer && typeof answer.score === "number" ? answer.score : null;
}

function choiceOf(answer) {
  return answer && typeof answer.choice === "string" ? answer.choice : null;
}

function probabilityOf(answer) {
  return answer && typeof answer.noul === "number" ? answer.noul : null;
}

function toHumanMcp(result) {
  const answers = result && result.answers ? result.answers : {};
  const commitmentProbability = probabilityOf(answers.external_commitment);
  return {
    protocol: "human-mcp/0.1",
    next_step: choiceOf(answers.next_step),
    work_mode: choiceOf(answers.work_mode),
    urgency: scoreOf(answers.urgency),
    effort: scoreOf(answers.effort),
    requires_confirmation:
      commitmentProbability === null ? null : commitmentProbability >= 0.5,
    external_commitment_probability: commitmentProbability,
    model: result && result.model ? result.model : null
  };
}

module.exports = { ABP_QUESTIONS, toHumanMcp };
