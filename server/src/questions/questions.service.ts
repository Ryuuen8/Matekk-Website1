import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { randomInt, randomUUID } from 'node:crypto';
import { CreateQuestionDto, ExamAnswerDto } from './dto/questions.dto.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { StorageService } from '../storage/storage.service.js';
import { GradebookService } from '../gradebook/gradebook.service.js';
import { parseDragDropAnswer } from './drag-drop-answer.js';

const EXAM_CONFIG = {
  short: { questionCount: 50, durationSeconds: 45 * 60, title: 'Short Exam' },
  medium: { questionCount: 100, durationSeconds: 90 * 60, title: 'Medium Exam' },
  long: { questionCount: 150, durationSeconds: 120 * 60, title: 'Long Exam' },
} as const;

type ExamKey = keyof typeof EXAM_CONFIG;
type ExamQuestionBase = {
  id: number;
  prompt: string;
  imageUrl?: string | null;
  options: string[];
  module: string | null;
  topic: string | null;
};
type SingleExamQuestion = ExamQuestionBase & { type: 'single' };
type MatchExamQuestion = Omit<ExamQuestionBase, 'options'> & {
  type: 'match' | 'drag_drop' | 'click_boxes' | 'image';
  items: string[];
  choices: string[];
  groupSizes?: number[];
};
type ExamQuestion = SingleExamQuestion | MatchExamQuestion;

const QUESTIONS_PER_BLOCK = {
  match: 5,
  dragDrop: 3,
  clickBoxes: 1,
  image: 1,
  single: 40,
} as const;

@Injectable()
export class QuestionsService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private gradebook: GradebookService,
  ) {}

  create(data: CreateQuestionDto) {
    const questionType = data.question_type ?? 'single';
    let correctAnswer: string;
    if (questionType !== 'single') {
      if (
        !data.match_items ||
        !data.match_answer ||
        data.match_items.length !== data.match_answer.length ||
        data.choices.some((choice) => !choice.trim()) ||
        new Set(data.choices).size !== data.choices.length ||
        data.match_items.some((item) => !item.trim()) ||
        data.match_answer.some((answer) =>
          !Number.isInteger(answer) || answer < 0 || answer >= data.choices.length,
        )
      ) {
        throw new BadRequestException('Each matching item must have a valid answer choice.');
      }
      if (questionType === 'drag_drop' &&
        new Set(data.match_answer).size !== data.match_answer.length) {
        throw new BadRequestException('Each drag-and-drop item must use a different answer choice.');
      }
      if (questionType === 'click_boxes' &&
        (data.match_items.length !== data.choices.length ||
          new Set(data.match_answer).size !== data.match_answer.length)) {
        throw new BadRequestException('Click-the-boxes questions must use each answer choice exactly once.');
      }
      if (questionType === 'image' && !data.imageUrl?.trim()) {
        throw new BadRequestException('An image question must include an image URL.');
      }
      if (questionType === 'image' && data.choices.length > data.match_items.length) {
        throw new BadRequestException('An image question must have at least as many items as answer groups.');
      }
      correctAnswer = JSON.stringify(data.match_answer);
    } else if (!data.correct_answer || !data.choices.includes(data.correct_answer)) {
      throw new BadRequestException('The correct answer must be one of the question choices.');
    } else {
      correctAnswer = data.correct_answer;
    }

    return this.prisma.questions.create({
      data: {
        module: data.module,
        topic: data.topic,
        difficulty: data.difficulty,
        question_text: data.question_text,
        choices: JSON.stringify(data.choices),
        correct_answer: correctAnswer,
        explanation: data.explanation,
        question_type: questionType,
        ...(questionType !== 'single' ? { match_items: data.match_items } : {}),
        ...(data.imageUrl ? { imageUrl: data.imageUrl } : {}),
      },
    });
  }

  findAll() {
    return this.prisma.questions.findMany();
  }

  async startExam(examKey: string, userId: number) {
    const config = this.getExamConfig(examKey);
    const bank = await this.prisma.questions.findMany();
    const seenPrompts = new Set<string>();
    const usableQuestions = bank.flatMap((record) => {
      const question = this.readQuestion(record);
      return question ? [question] : [];
    }).filter((question) => {
      const promptKey = question.prompt.replace(/\s+/g, ' ').trim().toLowerCase();
      if (seenPrompts.has(promptKey)) return false;
      seenPrompts.add(promptKey);
      return true;
    });

    if (usableQuestions.length < config.questionCount) {
      throw new BadRequestException(
        bank.length === 0
          ? `This exam requires ${config.questionCount} questions, but the Questions table is empty.`
          : `This exam requires ${config.questionCount} valid questions. The Questions table has ${bank.length} rows, but only ${usableQuestions.length} have a readable prompt, choices, and matching correct answer.`,
      );
    }

    // Persist each randomized set so a resumed attempt keeps the same questions and option order.
    const questionBlocks = config.questionCount / 50;
    const requiredDragDrop = questionBlocks * QUESTIONS_PER_BLOCK.dragDrop;
    const requiredClickBoxes = questionBlocks * QUESTIONS_PER_BLOCK.clickBoxes;
    const requiredImages = questionBlocks * QUESTIONS_PER_BLOCK.image;
    const requiredMatches = questionBlocks * QUESTIONS_PER_BLOCK.match;
    const matchingQuestions = usableQuestions.filter((question) => question.type === 'match');
    const dragDropQuestions = usableQuestions.filter(
      (question): question is MatchExamQuestion => question.type === 'drag_drop',
    );
    const clickBoxesQuestions = usableQuestions.filter((question) => question.type === 'click_boxes');
    const imageQuestions = usableQuestions.filter((question) => question.type === 'image');
    const singleQuestions = usableQuestions.filter((question) => question.type === 'single');
    const requiredSingles = questionBlocks * QUESTIONS_PER_BLOCK.single;
    const missingClickBoxes = Math.max(0, requiredClickBoxes - clickBoxesQuestions.length);
    const randomizedDragDropPool = this.shuffle(dragDropQuestions);
    const borrowedClickBoxes = missingClickBoxes > 0
      ? randomizedDragDropPool.slice(requiredDragDrop, requiredDragDrop + missingClickBoxes)
      : [];
    if (
      dragDropQuestions.length < requiredDragDrop + missingClickBoxes ||
      clickBoxesQuestions.length + borrowedClickBoxes.length < requiredClickBoxes ||
      imageQuestions.length < requiredImages ||
      matchingQuestions.length < requiredMatches ||
      singleQuestions.length < requiredSingles
    ) {
      throw new BadRequestException(
        `This exam requires ${requiredMatches} connect-the-dots, ${requiredDragDrop} drag-and-drop, ${requiredClickBoxes} click-the-boxes, ${requiredImages} image-based, and ${requiredSingles} multiple-choice questions. ` +
        `The Questions table has ${matchingQuestions.length} valid connect-the-dots, ${dragDropQuestions.length} valid drag-and-drop (including one-to-one questions eligible for the click-the-boxes interaction), ${clickBoxesQuestions.length} valid click-the-boxes, ${imageQuestions.length} valid image-based, and ${singleQuestions.length} valid multiple-choice questions.`,
      );
    }

    const randomizedMatches = this.shuffle(matchingQuestions);
    const borrowedIds = new Set(borrowedClickBoxes.map(({ id }) => id));
    const randomizedDragDrop = randomizedDragDropPool.filter(({ id }) => !borrowedIds.has(id));
    const randomizedClickBoxes = this.shuffle([
      ...clickBoxesQuestions,
      ...borrowedClickBoxes.map((question) => ({ ...question, type: 'click_boxes' as const })),
    ]);
    const randomizedImages = this.shuffle(imageQuestions);
    const randomizedSingles = this.shuffle(singleQuestions);
    const selectedQuestions = Array.from({ length: questionBlocks }, (_, blockIndex) => [
      ...randomizedMatches.slice(blockIndex * QUESTIONS_PER_BLOCK.match, (blockIndex + 1) * QUESTIONS_PER_BLOCK.match),
      ...randomizedDragDrop.slice(blockIndex * QUESTIONS_PER_BLOCK.dragDrop, (blockIndex + 1) * QUESTIONS_PER_BLOCK.dragDrop),
      ...randomizedClickBoxes.slice(blockIndex * QUESTIONS_PER_BLOCK.clickBoxes, (blockIndex + 1) * QUESTIONS_PER_BLOCK.clickBoxes),
      ...randomizedImages.slice(blockIndex * QUESTIONS_PER_BLOCK.image, (blockIndex + 1) * QUESTIONS_PER_BLOCK.image),
      ...randomizedSingles.slice(blockIndex * QUESTIONS_PER_BLOCK.single, (blockIndex + 1) * QUESTIONS_PER_BLOCK.single),
    ]).flatMap((block) => this.shuffle(block));
    const questionSet = selectedQuestions.map((question) => {
      if (question.type === 'single') {
        return { ...question, options: this.shuffle(question.options) };
      }
      const choiceOrder = this.shuffle(question.choices.map((_, index) => index));
      const groupSizes = question.groupSizes;
      return {
        ...question,
        choices: choiceOrder.map((index) => question.choices[index]),
        ...(groupSizes
          ? { groupSizes: choiceOrder.map((index) => groupSizes[index]) }
          : {}),
      };
    });
    const startedAt = new Date();
    const deadline = new Date(startedAt.getTime() + config.durationSeconds * 1000);
    const attempt = await this.prisma.examAttempt.create({
      data: {
        id: randomUUID(),
        userId,
        examKey,
        questionSet: questionSet satisfies Prisma.InputJsonValue,
        durationSeconds: config.durationSeconds,
        deadline,
      },
    });

    return this.toAttemptResponse(attempt, questionSet);
  }

  async resumeExam(examKey: string, attemptId: string, userId: number) {
    this.getExamConfig(examKey);
    const attempt = await this.prisma.examAttempt.findUnique({ where: { id: attemptId } });
    if (!attempt || attempt.userId !== userId || attempt.examKey !== examKey) {
      throw new NotFoundException('Exam attempt not found.');
    }

    const questionSet = this.parseQuestionSet(attempt.questionSet);
    if (attempt.submittedAt) {
      await this.recordGradebookResult(attempt, examKey, userId);
    }
    return this.toAttemptResponse(attempt, questionSet);
  }

  async submitExam(
    examKey: string,
    attemptId: string,
    userId: number,
    answers: ExamAnswerDto[],
  ) {
    this.getExamConfig(examKey);
    const attempt = await this.prisma.examAttempt.findUnique({ where: { id: attemptId } });
    if (!attempt || attempt.userId !== userId || attempt.examKey !== examKey) {
      throw new NotFoundException('Exam attempt not found.');
    }
    // Return the original result for retries instead of grading or recording a second submission.
    if (attempt.submittedAt) {
      await this.recordGradebookResult(attempt, examKey, userId);
      return this.toAttemptResponse(attempt, this.parseQuestionSet(attempt.questionSet));
    }

    const questionSet = this.parseQuestionSet(attempt.questionSet);
    const questionIds = new Set(questionSet.map(({ id }) => id));
    const submittedIds = new Set(answers.map(({ questionId }) => questionId));
    if (
      submittedIds.size !== answers.length ||
      answers.some(({ questionId }) => !questionIds.has(questionId))
    ) {
      throw new BadRequestException('Submitted answers do not match this exam attempt.');
    }

    const answerById = new Map(answers.map(({ questionId, selectedAnswer, selectedMatches }) => [
      questionId,
      selectedMatches ?? selectedAnswer ?? null,
    ]));
    const databaseQuestions = await this.prisma.questions.findMany({
      where: { id: { in: questionSet.map(({ id }) => id) } },
    });
    const sourceById = new Map(databaseQuestions.map((question) => [question.id, question]));
    const review = questionSet.map((question) => {
      const source = sourceById.get(question.id);
      const selectedAnswer = answerById.get(question.id) ?? null;
      if (!source || !source.correct_answer) {
        throw new InternalServerErrorException('A question in this exam is no longer available for grading.');
      }

      if (question.type !== 'single') {
        const correctAnswer = question.type === 'drag_drop'
          ? this.gradeDragDropAnswer(question, source)
          : question.type === 'image'
            ? this.gradeImageAnswer(question, source)
            : this.gradeStoredMatchingAnswer(question, source);
        if (correctAnswer.some((index) => index < 0)) {
          throw new InternalServerErrorException('A matching answer is no longer available for grading.');
        }
        if (question.type === 'click_boxes' &&
          (question.items.length !== question.choices.length ||
            new Set(correctAnswer).size !== correctAnswer.length)) {
          throw new InternalServerErrorException('A click-the-boxes answer is no longer available for grading.');
        }
        if (
          selectedAnswer !== null &&
          (!Array.isArray(selectedAnswer) ||
            selectedAnswer.length !== question.items.length ||
            selectedAnswer.some((index) =>
              index !== null &&
              (!Number.isInteger(index) || index < 0 || index >= question.choices.length),
            ))
        ) {
          throw new BadRequestException('A matching answer is not one of the choices for this exam.');
        }
        if (question.type === 'click_boxes' && Array.isArray(selectedAnswer) &&
          new Set(selectedAnswer.filter((index) => index !== null)).size !==
            selectedAnswer.filter((index) => index !== null).length) {
          throw new BadRequestException('Each click-the-boxes answer can only be used once.');
        }
        const selectedMatches = Array.isArray(selectedAnswer) ? selectedAnswer : null;
        const isCorrect = selectedMatches !== null &&
          correctAnswer.every((answer, index) => selectedMatches[index] === answer);
        return {
          id: question.id,
          prompt: question.prompt,
          imageUrl: question.imageUrl,
          type: question.type,
          items: question.items,
          choices: question.choices,
          selectedAnswer: selectedMatches,
          correctAnswer,
          module: question.module,
          topic: question.topic,
          explanation: source.explanation ?? '',
          isCorrect,
        };
      }

      const correctAnswer = this.findCorrectOption(question.options, source.correct_answer);
      if (!correctAnswer) {
        throw new InternalServerErrorException('A question in this exam is no longer available for grading.');
      }
      if (selectedAnswer !== null && (typeof selectedAnswer !== 'string' || !question.options.includes(selectedAnswer))) {
        throw new BadRequestException('An answer is not one of the choices for this exam.');
      }
      const selectedOption = typeof selectedAnswer === 'string' ? selectedAnswer : null;
      return {
        id: question.id,
        prompt: question.prompt,
        imageUrl: question.imageUrl,
        type: question.type,
        options: question.options,
        module: question.module,
        topic: question.topic,
        selectedAnswer: selectedOption,
        correctAnswer: correctAnswer,
        explanation: source.explanation ?? '',
        isCorrect: selectedOption === correctAnswer,
      };
    });
    const score = review.reduce((total, question) => total + Number(question.isCorrect), 0);
    const submittedAt = new Date();
    // Conditional update ensures only one concurrent request can finalize this attempt.
    const saved = await this.prisma.examAttempt.updateMany({
      where: { id: attemptId, userId, submittedAt: null },
      data: { score, review, submittedAt },
    });

    if (saved.count === 0) {
      const alreadySubmitted = await this.prisma.examAttempt.findUnique({ where: { id: attemptId } });
      if (!alreadySubmitted) throw new NotFoundException('Exam attempt not found.');
      await this.recordGradebookResult(alreadySubmitted, examKey, userId);
      return this.toAttemptResponse(alreadySubmitted, this.parseQuestionSet(alreadySubmitted.questionSet));
    }

    const submittedAttempt = { ...attempt, score, review, submittedAt };
    await this.recordGradebookResult(submittedAttempt, examKey, userId);
    return this.toAttemptResponse(
      submittedAttempt,
      questionSet,
    );
  }

  private gradeDragDropAnswer(
    question: MatchExamQuestion,
    source: {
      id: number;
      choices: string | null;
      correct_answer: string | null;
      question_type?: string | null;
    },
  ): number[] {
    if (!source.choices?.trim() &&
      (!source.question_type || source.question_type === 'single')) {
      const dragDrop = parseDragDropAnswer(source.correct_answer, source.id);
      if (!dragDrop) {
        throw new InternalServerErrorException('A matching answer is no longer available for grading.');
      }
      return dragDrop.answer.map((choiceIndex) =>
        question.choices.indexOf(dragDrop.choices[choiceIndex]),
      );
    }
    return this.gradeStoredMatchingAnswer(question, source);
  }

  private gradeImageAnswer(
    question: MatchExamQuestion,
    source: {
      id: number;
      choices: string | null;
      correct_answer: string | null;
      question_type?: string | null;
      imageUrl?: string | null;
    },
  ): number[] {
    if (!source.imageUrl?.trim()) {
      throw new InternalServerErrorException('An image question is no longer available.');
    }
    return this.gradeStoredMatchingAnswer(question, source);
  }

  private gradeStoredMatchingAnswer(
    question: MatchExamQuestion,
    source: {
      id: number;
      choices: string | null;
      correct_answer: string | null;
      question_type?: string | null;
    },
  ): number[] {
    if (!source.choices?.trim()) {
      return this.gradeDragDropAnswer(question, source);
    }
    const originalChoices = this.parseChoices(source.choices);
    if (!originalChoices) {
      throw new InternalServerErrorException('A matching question has invalid choices.');
    }
    const correctIndexes = this.parseMatchAnswer(
      source.correct_answer ?? '',
      question.items.length,
      originalChoices.length,
    );
    return correctIndexes.map((index) => question.choices.indexOf(originalChoices[index]));
  }

  private async recordGradebookResult(
    attempt: {
      id: string;
      score: number | null;
      submittedAt: Date | null;
      questionSet: Prisma.JsonValue;
    },
    examKey: string,
    userId: number,
  ) {
    if (attempt.score === null || !attempt.submittedAt) {
      throw new InternalServerErrorException('The submitted exam result is incomplete.');
    }
    const config = this.getExamConfig(examKey);
    const questionSet = this.parseQuestionSet(attempt.questionSet);
    await this.gradebook.recordAssessment(userId, 'ccna', {
      id: attempt.id,
      type: 'exam',
      programKey: 'ccna',
      title: config.title,
      score: attempt.score,
      maxScore: questionSet.length,
      submittedAt: attempt.submittedAt.getTime(),
    });
  }

  private getExamConfig(examKey: string) {
    if (!Object.hasOwn(EXAM_CONFIG, examKey)) {
      throw new BadRequestException('Choose a valid exam format.');
    }
    return EXAM_CONFIG[examKey as ExamKey];
  }

  private readQuestion(record: {
    id: number;
    question_text: string | null;
    choices: string | null;
    question_type?: string | null;
    match_items?: Prisma.JsonValue | null;
    module: string | null;
    topic: string | null;
    correct_answer: string | null;
    imageUrl?: string | null;
  }): ExamQuestion | null {
    if (
      record.question_text?.trim() &&
      !record.choices?.trim() &&
      (!record.question_type || record.question_type === 'single')
    ) {
      return record.imageUrl?.trim()
        ? this.readImageQuestion(record)
        : this.readDragDropQuestion(record);
    }

    // Ignore malformed bank rows so only questions that can be safely rendered and graded are selected.
    if (!record.question_text?.trim() || !record.choices || !record.correct_answer) return null;

    const options = this.parseChoices(record.choices);
    if (['match', 'drag_drop', 'click_boxes', 'image'].includes(record.question_type ?? '')) {
      return this.readStoredMatchingQuestion(record, options);
    }
    if (record.question_type && record.question_type !== 'single') return null;
    if (
      !Array.isArray(options) ||
      options.length < 2 ||
      options.length > 8 ||
      !options.every((option): option is string => typeof option === 'string' && option.trim().length > 0) ||
      !this.findCorrectOption(options, record.correct_answer)
    ) {
      return null;
    }

    return {
      id: record.id,
      prompt: record.question_text.trim(),
      imageUrl: record.imageUrl ?? null,
      type: 'single',
      options,
      module: record.module,
      topic: record.topic,
    };
  }

  private readDragDropQuestion(record: {
    id: number;
    question_text: string | null;
    correct_answer: string | null;
    module: string | null;
    topic: string | null;
    imageUrl?: string | null;
  }): MatchExamQuestion | null {
    if (!record.question_text?.trim()) return null;
    const parsed = parseDragDropAnswer(record.correct_answer, record.id);
    if (!parsed) return null;
    const hasReusableGroups = parsed.choices.length < parsed.items.length ||
      new Set(parsed.answer).size !== parsed.answer.length;
    return {
      id: record.id,
      prompt: record.question_text.trim(),
      imageUrl: record.imageUrl ?? null,
      type: hasReusableGroups ? 'match' : 'drag_drop',
      items: parsed.items,
      choices: parsed.choices,
      ...(hasReusableGroups
        ? { groupSizes: parsed.choices.map((_, index) => parsed.answer.filter((answer) => answer === index).length) }
        : {}),
      module: record.module,
      topic: record.topic,
    };
  }

  private readImageQuestion(
    record: {
      id: number;
      question_text: string | null;
      correct_answer: string | null;
      module: string | null;
      topic: string | null;
      imageUrl?: string | null;
    },
  ): MatchExamQuestion | null {
    if (!record.question_text?.trim() || !record.imageUrl?.trim()) return null;
    const parsed = parseDragDropAnswer(record.correct_answer, record.id);
    if (!parsed || parsed.choices.length > parsed.items.length) return null;
    const groupSizes = parsed.choices.map((_, choiceIndex) =>
      parsed.answer.filter((answer) => answer === choiceIndex).length,
    );
    return {
      id: record.id,
      prompt: record.question_text.trim(),
      imageUrl: record.imageUrl,
      type: 'image',
      items: parsed.items,
      choices: parsed.choices,
      groupSizes,
      module: record.module,
      topic: record.topic,
    };
  }

  private readStoredMatchingQuestion(
    record: {
      id: number;
      question_text: string | null;
      choices: string | null;
      correct_answer: string | null;
      question_type?: string | null;
      match_items?: Prisma.JsonValue | null;
      module: string | null;
      topic: string | null;
      imageUrl?: string | null;
    },
    options: string[] | null,
  ): MatchExamQuestion | null {
    const items = record.match_items;
    const matchItems = Array.isArray(items)
      ? items.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : [];
    if (
      !record.question_text?.trim() ||
      !record.correct_answer ||
      !options ||
      options.length < 2 ||
      options.length > 8 ||
      !options.every((option) => option.trim().length > 0) ||
      new Set(options).size !== options.length ||
      !Array.isArray(items) ||
      matchItems.length !== items.length ||
      matchItems.length < 2 ||
      matchItems.length > 8 ||
      new Set(matchItems).size !== matchItems.length
    ) {
      return null;
    }
    let correctIndexes: number[];
    try {
      correctIndexes = this.parseMatchAnswer(record.correct_answer, matchItems.length, options.length);
    } catch {
      return null;
    }
    const type = record.question_type === 'drag_drop'
      ? 'drag_drop'
      : record.question_type === 'click_boxes'
        ? 'click_boxes'
        : record.question_type === 'image'
          ? 'image'
          : 'match';
    if ((type === 'drag_drop' || type === 'click_boxes') &&
      new Set(correctIndexes).size !== correctIndexes.length) {
      return null;
    }
    if (type === 'click_boxes' && options.length !== matchItems.length) return null;
    if (type === 'image' && (!record.imageUrl?.trim() || options.length > matchItems.length)) {
      return null;
    }
    const groupedMatch = options.length <= matchItems.length &&
      (options.length !== matchItems.length || new Set(correctIndexes).size !== correctIndexes.length);
    return {
      id: record.id,
      prompt: record.question_text.trim(),
      imageUrl: record.imageUrl ?? null,
      type,
      items: matchItems,
      choices: options,
      ...(type === 'image'
        ? { groupSizes: options.map((_, index) => correctIndexes.filter((answer) => answer === index).length) }
        : groupedMatch
        ? { groupSizes: options.map((_, index) => correctIndexes.filter((answer) => answer === index).length) }
        : {}),
      module: record.module,
      topic: record.topic,
    };
  }

  private parseChoices(value: string | null): string[] | null {
    if (!value) return null;
    try {
      const parsed: unknown = JSON.parse(value);
      const choices = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === 'object'
          ? Object.values(parsed)
          : null;
      return Array.isArray(choices) &&
        choices.every((choice): choice is string => typeof choice === 'string')
        ? choices
        : null;
    } catch {
      return null;
    }
  }

  private parseMatchAnswer(answer: string, itemCount: number, choiceCount: number): number[] {
    let parsed: unknown;
    try {
      parsed = JSON.parse(answer);
    } catch {
      throw new Error('The matching answer key is invalid.');
    }
    if (
      !Array.isArray(parsed) ||
      parsed.length !== itemCount ||
      !parsed.every((index) => Number.isInteger(index) && index >= 0 && index < choiceCount)
    ) {
      throw new Error('The matching answer key is invalid.');
    }
    return parsed;
  }

  private findCorrectOption(options: string[], answer: string): string | null {
    const normalizedAnswer = answer.trim();
    const exactMatch = options.find((option) => option.trim().toLocaleLowerCase() === normalizedAnswer.toLocaleLowerCase());
    if (exactMatch) return exactMatch;

    const letterMatch = normalizedAnswer.match(/^\(?([a-h])\)?(?:[.)])?$/i);
    if (letterMatch) {
      const letter = letterMatch[1].toLocaleUpperCase();
      const labeledOption = options.find((option) =>
        new RegExp(`^\\s*\\(?${letter}\\)?[.)\\s:-]+`, 'i').test(option),
      );
      if (labeledOption) return labeledOption;
      const index = letter.charCodeAt(0) - 'A'.charCodeAt(0);
      if (index >= 0 && index < options.length) return options[index];
    }

    const indexMatch = normalizedAnswer.match(/^\(?(-?\d+)\)?(?:[.)])?$/);
    if (indexMatch) {
      const numericIndex = Number(indexMatch[1]);
      if (Number.isInteger(numericIndex)) {
        if (numericIndex >= 1 && numericIndex <= options.length) return options[numericIndex - 1];
        if (numericIndex >= 0 && numericIndex < options.length) return options[numericIndex];
      }
    }

    return null;
  }

  private parseQuestionSet(value: Prisma.JsonValue): ExamQuestion[] {
    if (!Array.isArray(value)) {
      throw new InternalServerErrorException('The saved exam attempt has invalid questions.');
    }
    return value.map((item) => {
      if (
        !item ||
        typeof item !== 'object' ||
        !('id' in item) ||
        !('prompt' in item) ||
        typeof item.id !== 'number' ||
        typeof item.prompt !== 'string' ||
        !('module' in item) ||
        !(typeof item.module === 'string' || item.module === null) ||
        !('topic' in item) ||
        !(typeof item.topic === 'string' || item.topic === null)
      ) {
        throw new InternalServerErrorException('The saved exam attempt has invalid questions.');
      }
      const type = 'type' in item &&
        (item.type === 'match' || item.type === 'drag_drop' || item.type === 'click_boxes' || item.type === 'image')
        ? item.type
        : 'single';
      if (type !== 'single') {
        const rawGroupSizes = 'groupSizes' in item ? item.groupSizes : undefined;
        const groupSizes = Array.isArray(rawGroupSizes) &&
          rawGroupSizes.every((size): size is number =>
            typeof size === 'number' && Number.isInteger(size) && size >= 0,
          )
          ? rawGroupSizes
          : undefined;
        if (
          !('items' in item) ||
          !Array.isArray(item.items) ||
          !item.items.every((matchItem): matchItem is string => typeof matchItem === 'string') ||
          !item.items.length ||
          item.items.length > 8 ||
          !('choices' in item) ||
          !Array.isArray(item.choices) ||
          item.choices.length < 2 ||
          item.choices.length > 8 ||
          !item.choices.every((choice): choice is string => typeof choice === 'string') ||
          (rawGroupSizes !== undefined &&
            (!Array.isArray(groupSizes) ||
              groupSizes.length !== item.choices.length ||
              groupSizes.reduce((total, size) => total + size, 0) !== item.items.length))
        ) {
          throw new InternalServerErrorException('The saved exam attempt has invalid questions.');
        }
        return {
          id: item.id,
          prompt: item.prompt,
          imageUrl: 'imageUrl' in item && (typeof item.imageUrl === 'string' || item.imageUrl === null)
            ? item.imageUrl
            : null,
          type,
          items: item.items,
          choices: item.choices,
          ...(Array.isArray(groupSizes) ? { groupSizes } : {}),
          module: item.module,
          topic: item.topic,
        };
      }
      if (
        !('options' in item) ||
        !Array.isArray(item.options) ||
        item.options.length < 2 ||
        item.options.length > 8 ||
        !item.options.every((option): option is string => typeof option === 'string')
      ) {
        throw new InternalServerErrorException('The saved exam attempt has invalid questions.');
      }
      return {
        id: item.id,
        prompt: item.prompt,
        imageUrl: 'imageUrl' in item && (typeof item.imageUrl === 'string' || item.imageUrl === null)
          ? item.imageUrl
          : null,
        type: 'single',
        options: item.options,
        module: item.module,
        topic: item.topic,
      };
    });
  }

  private async toAttemptResponse(
    attempt: {
      id: string;
      examKey: string;
      durationSeconds: number;
      deadline: Date;
      score: number | null;
      review: Prisma.JsonValue | null;
      submittedAt: Date | null;
    },
    questions: ExamQuestion[],
  ) {
    const imagePaths = [...new Set(questions.flatMap((question) =>
      question.imageUrl && !/^https?:\/\//i.test(question.imageUrl) ? [question.imageUrl] : [],
    ))];
    const signedImageUrls = await this.storage.createSignedQuestionImageUrls(imagePaths);
    const signedQuestions = questions.map((question) => ({
      ...question,
      imageUrl: question.imageUrl && !/^https?:\/\//i.test(question.imageUrl)
        ? signedImageUrls.get(question.imageUrl) ?? question.imageUrl
        : question.imageUrl ?? null,
    }));
    const signedImageByQuestionId = new Map(
      signedQuestions.map((question) => [question.id, question.imageUrl]),
    );
    const review = Array.isArray(attempt.review)
      ? attempt.review.map((entry) => {
        if (entry === null || Array.isArray(entry) || typeof entry !== 'object') return entry;
        const questionId = entry.id;
        if (typeof questionId !== 'number') return entry;
        const imageUrl = signedImageByQuestionId.get(questionId);
        return imageUrl ? { ...entry, imageUrl } : entry;
      })
      : attempt.review;

    // Keep correct answers out of start/resume responses; include them only in the post-submit review.
    return {
      attemptId: attempt.id,
      examKey: attempt.examKey,
      durationSeconds: attempt.durationSeconds,
      deadline: attempt.deadline.getTime(),
      score: attempt.score,
      review,
      submittedAt: attempt.submittedAt?.getTime() ?? null,
      isSubmitted: attempt.submittedAt !== null,
      questions: signedQuestions.map((question) =>
        question.type !== 'single'
          ? {
              id: question.id,
              prompt: question.prompt,
              imageUrl: question.imageUrl,
              type: question.type,
              items: question.items,
              choices: question.choices,
              ...(question.groupSizes ? { groupSizes: question.groupSizes } : {}),
              module: question.module,
              topic: question.topic,
            }
          : {
              id: question.id,
              prompt: question.prompt,
              imageUrl: question.imageUrl,
              type: question.type,
              options: question.options,
              module: question.module,
              topic: question.topic,
            },
      ),
    };
  }

  private shuffle<T>(items: T[]): T[] {
    const shuffled = [...items];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const nextIndex = randomInt(index + 1);
      [shuffled[index], shuffled[nextIndex]] = [shuffled[nextIndex], shuffled[index]];
    }
    return shuffled;
  }

  async findBank() {
    const rows = await this.prisma.questions.findMany({
      select: {
        id: true,
        module: true,
        topic: true,
        difficulty: true,
        question_text: true,
        choices: true,
        question_type: true,
        match_items: true,
        imageUrl: true,
      },
      orderBy: { id: 'asc' },
    });
    const signedRows = await this.signQuestionImages(rows);
    return signedRows.map((row) => ({
      id: row.id,
      module: row.module,
      topic: row.topic,
      difficulty: row.difficulty,
      question_text: row.question_text,
      choices: row.choices,
      question_type: row.question_type,
      match_items: row.match_items,
      imageUrl: row.imageUrl,
    }));
  }

  async findUsableBank() {
    const rows = await this.prisma.questions.findMany({
      select: {
        id: true,
        module: true,
        topic: true,
        question_text: true,
        choices: true,
        correct_answer: true,
        explanation: true,
        question_type: true,
        match_items: true,
        imageUrl: true,
      },
      orderBy: { id: 'asc' },
    });
    const signedRows = await this.signQuestionImages(rows);
    const questions = signedRows.flatMap((row) => {
      const question = this.readQuestion(row);
      if (!question) return [];

      const answer = question.type === 'single'
        ? question.options.indexOf(this.findCorrectOption(question.options, row.correct_answer) ?? '')
        : ['match', 'drag_drop', 'click_boxes', 'image'].includes(row.question_type ?? '')
          ? this.parseMatchAnswer(row.correct_answer, question.items.length, question.choices.length)
          : parseDragDropAnswer(row.correct_answer, row.id)?.answer;
      if (answer === undefined || answer === -1 || (Array.isArray(answer) && answer.length === 0)) {
        return [];
      }

      return [{
        ...question,
        bankId: row.id,
        answer,
        explanation: row.explanation,
        source: 'question-bank',
      }];
    });

    return { questions, skippedCount: rows.length - questions.length };
  }

  private async signQuestionImages<T extends { imageUrl: string | null }>(rows: T[]) {
    const imagePaths = [...new Set(rows.flatMap((row) =>
      row.imageUrl && !/^https?:\/\//i.test(row.imageUrl) ? [row.imageUrl] : [],
    ))];
    const signedUrls = await this.storage.createSignedQuestionImageUrls(imagePaths);

    return rows.map((row) => ({
      ...row,
      imageUrl: row.imageUrl ? signedUrls.get(row.imageUrl) ?? row.imageUrl : null,
    }));
  }
}
