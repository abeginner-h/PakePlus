/**
 * AI任务规划服务
 * 提供智能任务分析、优化和预测功能
 */

class AITaskService {
    constructor(config) {
        this.config = {
            endpoint: 'https://www.sophnet.com/api/open-apis/v1/chat/completions',
            apiKey: 'nAmqdv--CbWf8E0RWgl8K53PhdAM4nqUcaFHwi07phKbUX_6ckOwdNl6SAH_oz-Cy-Bjl3U1IOemNoRT7ZSRtg',
            model: 'DeepSeek-R1-0528',
            ...config
        };
        
        this.isOnline = navigator.onLine;
        this.requestQueue = [];
        this.cache = new Map();
        this.setupOfflineHandling();
        this.initializePatterns();
    }

    setupOfflineHandling() {
        window.addEventListener('online', () => {
            this.isOnline = true;
            this.processQueue();
        });
        
        window.addEventListener('offline', () => {
            this.isOnline = false;
        });
    }

    initializePatterns() {
        // 预定义的任务模式和启发式规则
        this.taskPatterns = {
            priorities: {
                keywords: {
                    high: ['紧急', '重要', '截止', '必须', '优先', '关键', '立即', '马上', '今天'],
                    medium: ['应该', '计划', '安排', '准备', '考虑', '建议', '希望'],
                    low: ['可以', '想要', '有空', '闲时', '方便', '随时', '可能']
                },
                timeIndicators: {
                    high: ['今天', '明天', '本周', '紧急'],
                    medium: ['下周', '本月', '近期'],
                    low: ['将来', '有时间', '以后', '闲时']
                }
            },
            
            categories: {
                work: ['工作', '会议', '项目', '报告', '邮件', '文档', '开发', '编程', '设计', '客户'],
                personal: ['个人', '家庭', '朋友', '购物', '生活', '家务', '整理', '清洁'],
                learning: ['学习', '阅读', '研究', '培训', '课程', '教程', '技能', '知识'],
                health: ['运动', '健身', '锻炼', '跑步', '瑜伽', '医生', '体检', '健康']
            },

            timeEstimation: {
                simple: { baseTime: 1, keywords: ['简单', '快速', '轻松', '容易', '基础'] },
                medium: { baseTime: 2, keywords: ['一般', '正常', '标准', '常规'] },
                complex: { baseTime: 4, keywords: ['复杂', '困难', '深入', '详细', '彻底', '全面'] }
            }
        };
    }

    // 主要AI分析入口
    async analyzeTasksWithAI(tasks, userContext = {}) {
        const cacheKey = this.generateCacheKey('analyze', tasks, userContext);
        
        if (this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey);
        }

        if (!this.isOnline) {
            return this.offlineAnalysis(tasks, userContext);
        }

        try {
            const prompt = this.buildAnalysisPrompt(tasks, userContext);
            const response = await this.callAI(prompt);
            const result = this.parseAIResponse(response);
            
            // 缓存结果
            this.cache.set(cacheKey, result);
            
            return result;
        } catch (error) {
            console.error('AI分析失败，使用离线模式:', error);
            return this.offlineAnalysis(tasks, userContext);
        }
    }

    buildAnalysisPrompt(tasks, userContext) {
        const currentTime = new Date();
        const timeOfDay = this.getTimeOfDay();
        
        return `
作为专业的任务规划AI助手，请分析以下任务列表并提供智能优化建议。

## 任务列表
${JSON.stringify(tasks.map(task => ({
    id: task.id,
    text: task.text,
    priority: task.priority,
    category: task.category,
    estimatedPomodoros: task.estimatedPomodoros,
    completedPomodoros: task.completedPomodoros,
    deadline: task.deadline,
    complexity: task.complexity,
    tags: task.tags
})), null, 2)}

## 用户上下文
- 当前时间: ${currentTime.toLocaleString('zh-CN')}
- 时段: ${timeOfDay}
- 能量水平: ${userContext.energyLevel || 'medium'}
- 偏好工作时间: ${userContext.preferredWorkTime || 'morning'}
- 工作风格: ${userContext.workStyle || 'focused'}
- 历史完成模式: ${JSON.stringify(userContext.completionPatterns || {})}

## 分析要求
请返回结构化的JSON响应，包含以下内容：

1. **优化任务顺序**: 基于优先级、能量水平、时间匹配度重新排序
2. **时间块规划**: 将任务分配到具体时间段，考虑休息间隔
3. **智能建议**: 提供具体的优化建议和理由
4. **工作负荷分析**: 评估当前工作量分布
5. **风险预警**: 识别可能的问题和瓶颈

返回格式：
{
    "optimizedOrder": ["task_id_1", "task_id_2", ...],
    "timeBlocks": [
        {
            "startTime": "09:00",
            "endTime": "09:25",
            "taskId": "task_id_1",
            "type": "work",
            "reason": "高能量时段适合高优先级任务"
        },
        {
            "startTime": "09:25",
            "endTime": "09:30",
            "taskId": null,
            "type": "break",
            "reason": "短休息"
        }
    ],
    "suggestions": [
        {
            "type": "priority|timing|break|estimation|optimization",
            "taskId": "task_id",
            "message": "具体建议内容",
            "reason": "建议原因",
            "confidence": 0.85,
            "impact": "high|medium|low"
        }
    ],
    "workloadAnalysis": {
        "totalPomodoros": 12,
        "distribution": {
            "morning": 6,
            "afternoon": 4,
            "evening": 2
        },
        "intensity": "balanced|heavy|light",
        "recommendation": "建议文本"
    },
    "riskAssessment": [
        {
            "type": "overload|deadline|complexity",
            "severity": "high|medium|low",
            "message": "风险描述",
            "mitigation": "缓解建议"
        }
    ],
    "learningInsights": {
        "patterns": "识别的用户模式",
        "suggestions": "基于历史数据的建议"
    }
}
`;
    }

    async callAI(prompt, options = {}) {
        const requestBody = {
            model: this.config.model,
            messages: [
                {
                    role: 'system',
                    content: `你是一个专业的AI任务规划助手，专精于番茄工作法和时间管理。你能够：
1. 分析任务优先级和复杂度
2. 优化任务执行顺序
3. 合理分配时间块
4. 预测工作负荷
5. 提供个性化建议
6. 学习用户习惯

回复必须是有效的JSON格式，确保数据结构完整且逻辑合理。`
                },
                {
                    role: 'user',
                    content: prompt
                }
            ],
            temperature: 0.7,
            max_tokens: 3000,
            top_p: 0.9,
            ...options
        };

        const response = await fetch(this.config.endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.config.apiKey}`,
                'User-Agent': 'AI-Pomodoro-Timer/1.0'
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            throw new Error(`API请求失败: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        return data.choices[0].message.content;
    }

    parseAIResponse(response) {
        try {
            // 尝试解析JSON响应
            const parsed = JSON.parse(response);
            
            // 验证响应结构
            this.validateResponseStructure(parsed);
            
            return {
                success: true,
                data: parsed,
                timestamp: new Date(),
                source: 'ai'
            };
        } catch (error) {
            console.error('AI响应解析失败:', error);
            
            // 尝试提取部分有用信息
            return this.extractPartialResponse(response);
        }
    }

    validateResponseStructure(data) {
        const required = ['optimizedOrder', 'suggestions', 'workloadAnalysis'];
        for (const field of required) {
            if (!data.hasOwnProperty(field)) {
                throw new Error(`缺少必需字段: ${field}`);
            }
        }
    }

    extractPartialResponse(response) {
        // 从文本响应中提取有用信息
        const suggestions = this.extractSuggestions(response);
        
        return {
            success: false,
            data: {
                suggestions,
                optimizedOrder: [],
                workloadAnalysis: { totalPomodoros: 0, intensity: 'unknown' }
            },
            timestamp: new Date(),
            source: 'partial',
            originalResponse: response
        };
    }

    extractSuggestions(text) {
        const suggestions = [];
        const lines = text.split('\n');
        
        for (const line of lines) {
            if (line.includes('建议') || line.includes('推荐') || line.includes('应该')) {
                suggestions.push({
                    type: 'general',
                    message: line.trim(),
                    confidence: 0.5,
                    source: 'text_extraction'
                });
            }
        }
        
        return suggestions;
    }

    // 离线分析功能
    offlineAnalysis(tasks, userContext) {
        const analysis = {
            optimizedOrder: this.optimizeTaskOrder(tasks, userContext),
            timeBlocks: this.generateTimeBlocks(tasks, userContext),
            suggestions: this.generateOfflineSuggestions(tasks, userContext),
            workloadAnalysis: this.analyzeWorkload(tasks),
            riskAssessment: this.assessRisks(tasks),
            learningInsights: this.extractLearningInsights(userContext)
        };

        return {
            success: true,
            data: analysis,
            timestamp: new Date(),
            source: 'offline'
        };
    }

    optimizeTaskOrder(tasks, userContext) {
        // 基于启发式算法优化任务顺序
        const scoredTasks = tasks.map(task => ({
            ...task,
            score: this.calculateTaskScore(task, userContext)
        }));

        return scoredTasks
            .sort((a, b) => b.score - a.score)
            .map(task => task.id);
    }

    calculateTaskScore(task, userContext) {
        let score = 0;
        
        // 优先级权重 (40%)
        const priorityWeights = { high: 100, medium: 60, low: 20 };
        score += (priorityWeights[task.priority] || 60) * 0.4;
        
        // 截止日期权重 (30%)
        if (task.deadline) {
            const daysUntilDeadline = this.getDaysUntilDeadline(task.deadline);
            score += Math.max(0, 100 - daysUntilDeadline * 10) * 0.3;
        }
        
        // 能量水平匹配 (20%)
        const energyMatch = this.getEnergyMatch(task, userContext.energyLevel);
        score += energyMatch * 0.2;
        
        // 时间匹配度 (10%)
        const timeMatch = this.getTimeMatch(task, userContext.preferredWorkTime);
        score += timeMatch * 0.1;
        
        return score;
    }

    getDaysUntilDeadline(deadline) {
        const deadlineDate = new Date(deadline);
        const today = new Date();
        const diffTime = deadlineDate - today;
        return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    }

    getEnergyMatch(task, energyLevel) {
        const complexityEnergyMap = {
            high: { simple: 50, medium: 80, complex: 100 },
            medium: { simple: 80, medium: 100, complex: 60 },
            low: { simple: 100, medium: 60, complex: 20 }
        };
        
        return complexityEnergyMap[energyLevel]?.[task.complexity] || 50;
    }

    getTimeMatch(task, preferredTime) {
        if (!task.timeOfDay || task.timeOfDay === 'anytime') return 50;
        return task.timeOfDay === preferredTime ? 100 : 30;
    }

    generateTimeBlocks(tasks, userContext) {
        const blocks = [];
        const startTime = this.getOptimalStartTime(userContext);
        let currentTime = new Date();
        
        // 设置开始时间
        const [hours, minutes] = startTime.split(':').map(Number);
        currentTime.setHours(hours, minutes, 0, 0);
        
        const optimizedTasks = this.optimizeTaskOrder(tasks, userContext);
        
        for (const taskId of optimizedTasks) {
            const task = tasks.find(t => t.id === taskId);
            if (!task || task.completed) continue;
            
            // 添加工作时间块
            const startTimeStr = this.formatTime(currentTime);
            currentTime.setMinutes(currentTime.getMinutes() + 25);
            const endTimeStr = this.formatTime(currentTime);
            
            blocks.push({
                startTime: startTimeStr,
                endTime: endTimeStr,
                taskId: task.id,
                type: 'work',
                reason: this.getWorkBlockReason(task, userContext)
            });
            
            // 添加休息时间块
            const breakDuration = this.getBreakDuration(blocks.length);
            const breakStartStr = this.formatTime(currentTime);
            currentTime.setMinutes(currentTime.getMinutes() + breakDuration);
            const breakEndStr = this.formatTime(currentTime);
            
            blocks.push({
                startTime: breakStartStr,
                endTime: breakEndStr,
                taskId: null,
                type: 'break',
                reason: breakDuration === 15 ? '长休息 - 恢复精力' : '短休息 - 保持专注'
            });
        }
        
        return blocks;
    }

    getOptimalStartTime(userContext) {
        const timePreferences = {
            morning: '09:00',
            afternoon: '14:00',
            evening: '19:00'
        };
        
        return timePreferences[userContext.preferredWorkTime] || '09:00';
    }

    getWorkBlockReason(task, userContext) {
        const reasons = [];
        
        if (task.priority === 'high') {
            reasons.push('高优先级任务');
        }
        
        if (task.deadline) {
            const days = this.getDaysUntilDeadline(task.deadline);
            if (days <= 1) reasons.push('临近截止日期');
        }
        
        const energyMatch = this.getEnergyMatch(task, userContext.energyLevel);
        if (energyMatch > 80) {
            reasons.push('能量水平匹配');
        }
        
        return reasons.length > 0 ? reasons.join(', ') : '按优化顺序排列';
    }

    getBreakDuration(completedPomodoros) {
        return (completedPomodoros % 4 === 0) ? 15 : 5;
    }

    formatTime(date) {
        return date.toLocaleTimeString('zh-CN', { 
            hour: '2-digit', 
            minute: '2-digit',
            hour12: false
        });
    }

    generateOfflineSuggestions(tasks, userContext) {
        const suggestions = [];
        
        // 分析任务分布
        const priorityDistribution = this.analyzePriorityDistribution(tasks);
        if (priorityDistribution.high > priorityDistribution.medium + priorityDistribution.low) {
            suggestions.push({
                type: 'balance',
                message: '高优先级任务较多，建议分散到多天完成',
                reason: '避免过度集中导致疲劳',
                confidence: 0.8,
                impact: 'medium'
            });
        }
        
        // 检查工作量
        const totalPomodoros = tasks.reduce((sum, task) => sum + task.estimatedPomodoros, 0);
        if (totalPomodoros > 12) {
            suggestions.push({
                type: 'workload',
                message: '今日任务量较大，建议优先完成关键任务',
                reason: '超过8小时工作量可能影响效率',
                confidence: 0.9,
                impact: 'high'
            });
        }
        
        // 能量水平建议
        if (userContext.energyLevel === 'low') {
            suggestions.push({
                type: 'energy',
                message: '当前能量较低，建议从简单任务开始',
                reason: '循序渐进有助于建立工作节奏',
                confidence: 0.7,
                impact: 'medium'
            });
        }
        
        return suggestions;
    }

    analyzePriorityDistribution(tasks) {
        return tasks.reduce((dist, task) => {
            dist[task.priority] = (dist[task.priority] || 0) + 1;
            return dist;
        }, {});
    }

    analyzeWorkload(tasks) {
        const totalPomodoros = tasks.reduce((sum, task) => sum + task.estimatedPomodoros, 0);
        const completedPomodoros = tasks.reduce((sum, task) => sum + task.completedPomodoros, 0);
        
        let intensity = 'balanced';
        if (totalPomodoros > 16) intensity = 'heavy';
        else if (totalPomodoros < 6) intensity = 'light';
        
        return {
            totalPomodoros,
            completedPomodoros,
            remainingPomodoros: totalPomodoros - completedPomodoros,
            intensity,
            estimatedHours: totalPomodoros * 0.5,
            recommendation: this.getWorkloadRecommendation(totalPomodoros, intensity)
        };
    }

    getWorkloadRecommendation(totalPomodoros, intensity) {
        switch (intensity) {
            case 'heavy':
                return '工作量较大，建议分优先级执行，适当延期非紧急任务';
            case 'light':
                return '工作量适中，可以考虑添加学习或改进类任务';
            default:
                return '工作量平衡，保持当前节奏';
        }
    }

    assessRisks(tasks) {
        const risks = [];
        
        // 检查截止日期风险
        const urgentTasks = tasks.filter(task => {
            if (!task.deadline) return false;
            const days = this.getDaysUntilDeadline(task.deadline);
            return days <= 1 && !task.completed;
        });
        
        if (urgentTasks.length > 0) {
            risks.push({
                type: 'deadline',
                severity: 'high',
                message: `${urgentTasks.length}个任务即将到期`,
                mitigation: '优先处理紧急任务，考虑推迟其他工作'
            });
        }
        
        // 检查工作量风险
        const totalPomodoros = tasks.reduce((sum, task) => sum + task.estimatedPomodoros, 0);
        if (totalPomodoros > 20) {
            risks.push({
                type: 'overload',
                severity: 'medium',
                message: '工作量可能过大，存在疲劳风险',
                mitigation: '适当调整期望，安排充分休息'
            });
        }
        
        return risks;
    }

    extractLearningInsights(userContext) {
        const insights = {
            patterns: [],
            suggestions: []
        };
        
        if (userContext.completionPatterns) {
            const patterns = Object.entries(userContext.completionPatterns);
            if (patterns.length > 0) {
                const mostFrequent = patterns.reduce((a, b) => a[1] > b[1] ? a : b);
                insights.patterns.push(`您最常完成的是${mostFrequent[0]}类任务`);
            }
        }
        
        if (userContext.productiveHours && userContext.productiveHours.length > 0) {
            const avgHour = Math.round(
                userContext.productiveHours.reduce((a, b) => a + b, 0) / 
                userContext.productiveHours.length
            );
            insights.suggestions.push(`根据历史数据，您在${avgHour}:00左右效率最高`);
        }
        
        return insights;
    }

    // 自然语言处理
    async processNaturalLanguage(input, currentTasks = []) {
        if (!this.isOnline) {
            return this.offlineNLPProcessing(input, currentTasks);
        }

        try {
            const prompt = this.buildNLPPrompt(input, currentTasks);
            const response = await this.callAI(prompt);
            return this.parseNLPResponse(response);
        } catch (error) {
            console.error('自然语言处理失败:', error);
            return this.offlineNLPProcessing(input, currentTasks);
        }
    }

    buildNLPPrompt(input, currentTasks) {
        return `
用户输入: "${input}"
当前任务列表: ${JSON.stringify(currentTasks.map(t => ({ id: t.id, text: t.text, priority: t.priority })), null, 2)}

请分析用户意图并返回JSON格式的操作指令：

{
    "intent": "add_task|modify_task|delete_task|reorder_tasks|set_priority|estimate_time|ask_question|get_analysis",
    "confidence": 0.0-1.0,
    "action": {
        "type": "具体操作类型",
        "parameters": {
            "taskText": "任务文本（如果是添加任务）",
            "taskId": "任务ID（如果是修改任务）",
            "priority": "high|medium|low",
            "category": "work|personal|learning|health",
            "estimatedPomodoros": 数字,
            "deadline": "YYYY-MM-DD（如果提到时间）"
        }
    },
    "response": "给用户的友好回复",
    "suggestions": ["建议1", "建议2"]
}

支持的操作示例：
- "添加任务：完成项目报告" → add_task
- "把XXX任务设为高优先级" → set_priority
- "删除XXX任务" → delete_task
- "这个任务需要几个番茄？" → estimate_time
- "优化我的任务安排" → get_analysis
`;
    }

    parseNLPResponse(response) {
        try {
            const parsed = JSON.parse(response);
            return {
                success: true,
                intent: parsed.intent,
                action: parsed.action,
                response: parsed.response,
                suggestions: parsed.suggestions || [],
                confidence: parsed.confidence || 0.5
            };
        } catch (error) {
            return this.offlineNLPProcessing(response);
        }
    }

    offlineNLPProcessing(input, currentTasks = []) {
        const normalizedInput = input.toLowerCase();
        
        // 简单的意图识别
        if (normalizedInput.includes('添加') || normalizedInput.includes('新任务')) {
            return {
                success: true,
                intent: 'add_task',
                action: {
                    type: 'add_task',
                    parameters: {
                        taskText: this.extractTaskText(input),
                        priority: this.extractPriority(input),
                        category: this.extractCategory(input)
                    }
                },
                response: '我帮您添加这个任务',
                confidence: 0.7
            };
        }
        
        if (normalizedInput.includes('删除') || normalizedInput.includes('移除')) {
            return {
                success: true,
                intent: 'delete_task',
                response: '请在任务列表中选择要删除的任务',
                confidence: 0.6
            };
        }
        
        if (normalizedInput.includes('优化') || normalizedInput.includes('分析') || normalizedInput.includes('安排')) {
            return {
                success: true,
                intent: 'get_analysis',
                response: '我将为您分析并优化任务安排',
                confidence: 0.8
            };
        }
        
        return {
            success: false,
            intent: 'unknown',
            response: '抱歉，我没有理解您的意思。您可以尝试说"添加任务"、"优化安排"等',
            confidence: 0.1
        };
    }

    extractTaskText(input) {
        // 提取任务文本的简单规则
        const match = input.match(/(?:添加|新增)(?:任务)?[:：]?\s*(.+)/);
        return match ? match[1].trim() : input;
    }

    extractPriority(input) {
        const highKeywords = ['重要', '紧急', '优先', '关键'];
        const lowKeywords = ['不急', '有空', '闲时'];
        
        for (const keyword of highKeywords) {
            if (input.includes(keyword)) return 'high';
        }
        
        for (const keyword of lowKeywords) {
            if (input.includes(keyword)) return 'low';
        }
        
        return 'medium';
    }

    extractCategory(input) {
        for (const [category, keywords] of Object.entries(this.taskPatterns.categories)) {
            for (const keyword of keywords) {
                if (input.includes(keyword)) return category;
            }
        }
        return 'work';
    }

    getTimeOfDay() {
        const hour = new Date().getHours();
        if (hour < 12) return 'morning';
        if (hour < 18) return 'afternoon';
        return 'evening';
    }

    generateCacheKey(operation, ...params) {
        return `${operation}_${JSON.stringify(params).slice(0, 100)}`;
    }

    async processQueue() {
        while (this.requestQueue.length > 0 && this.isOnline) {
            const request = this.requestQueue.shift();
            try {
                const result = await this[request.method](...request.params);
                request.resolve(result);
            } catch (error) {
                request.reject(error);
            }
        }
    }

    // 任务分类和智能标签
    async categorizeTask(taskText) {
        if (!this.isOnline) {
            return this.offlineTaskCategorization(taskText);
        }

        try {
            const prompt = `
分析任务"${taskText}"并返回详细分类信息：

{
    "category": "work|personal|learning|health|others",
    "priority": "high|medium|low",
    "estimatedPomodoros": 1-8,
    "complexity": "simple|medium|complex",
    "timeOfDay": "morning|afternoon|evening|anytime",
    "tags": ["标签1", "标签2"],
    "suggestedDeadline": "YYYY-MM-DD或null",
    "dependencies": [],
    "energyRequired": "low|medium|high",
    "focusLevel": "light|medium|deep"
}

分析要点：
1. 根据任务内容判断类别和优先级
2. 估算合理的番茄数量（1个番茄=25分钟）
3. 考虑任务的复杂度和所需专注度
4. 推荐合适的执行时间段
5. 提取相关标签便于分类管理
`;

            const response = await this.callAI(prompt);
            return this.parseTaskCategorization(response);
        } catch (error) {
            return this.offlineTaskCategorization(taskText);
        }
    }

    parseTaskCategorization(response) {
        try {
            const parsed = JSON.parse(response);
            return {
                success: true,
                data: parsed,
                source: 'ai'
            };
        } catch (error) {
            return this.offlineTaskCategorization('');
        }
    }

    offlineTaskCategorization(taskText) {
        const category = this.extractCategory(taskText);
        const priority = this.extractPriority(taskText);
        const complexity = this.estimateComplexity(taskText);
        
        return {
            success: true,
            data: {
                category,
                priority,
                estimatedPomodoros: this.estimatePomodoros(taskText, complexity),
                complexity,
                timeOfDay: 'anytime',
                tags: this.extractTags(taskText),
                suggestedDeadline: null,
                dependencies: [],
                energyRequired: complexity === 'complex' ? 'high' : 'medium',
                focusLevel: complexity === 'simple' ? 'light' : 'medium'
            },
            source: 'offline'
        };
    }

    estimateComplexity(taskText) {
        const complexKeywords = ['复杂', '困难', '深入', '详细', '分析', '设计', '开发'];
        const simpleKeywords = ['简单', '快速', '轻松', '整理', '检查', '确认'];
        
        for (const keyword of complexKeywords) {
            if (taskText.includes(keyword)) return 'complex';
        }
        
        for (const keyword of simpleKeywords) {
            if (taskText.includes(keyword)) return 'simple';
        }
        
        return 'medium';
    }

    estimatePomodoros(taskText, complexity) {
        const baseEstimates = {
            simple: 1,
            medium: 2,
            complex: 4
        };
        
        let estimate = baseEstimates[complexity];
        
        // 根据关键词调整估算
        if (taskText.includes('会议')) estimate = Math.max(1, Math.ceil(estimate / 2));
        if (taskText.includes('报告') || taskText.includes('文档')) estimate += 1;
        if (taskText.includes('学习') || taskText.includes('研究')) estimate += 2;
        
        return Math.min(8, Math.max(1, estimate));
    }

    extractTags(taskText) {
        const tags = [];
        const tagPatterns = {
            '会议': /会议|meeting|讨论|沟通/i,
            '文档': /文档|报告|记录|总结/i,
            '编程': /编程|代码|开发|bug|测试/i,
            '学习': /学习|阅读|研究|教程/i,
            '设计': /设计|UI|UX|原型/i
        };
        
        for (const [tag, pattern] of Object.entries(tagPatterns)) {
            if (pattern.test(taskText)) {
                tags.push(tag);
            }
        }
        
        return tags;
    }
}

// 导出供其他模块使用
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AITaskService;
} else if (typeof window !== 'undefined') {
    window.AITaskService = AITaskService;
}