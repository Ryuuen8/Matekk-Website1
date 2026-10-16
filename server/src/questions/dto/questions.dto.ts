import {
    IsOptional,
    ArrayMaxSize,
    ArrayMinSize,
    IsArray,
    IsIn,
    IsString,
    IsInt,
    Length,
    MaxLength,
    Min,
    ValidateIf,
    ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateQuestionDto {
    @IsString()
    @Length(1, 120)
    module: string;

    @IsString()
    @Length(1, 120)
    topic: string;

    @IsIn(['Easy', 'Medium', 'Hard'])
    difficulty: 'Easy' | 'Medium' | 'Hard';

    @IsString()
    @Length(1, 5000)
    question_text: string;

    @IsArray()
    @ArrayMinSize(2)
    @ArrayMaxSize(8)
    @IsString({ each: true })
    @Length(1, 500, { each: true })
    choices: string[];

    @IsOptional()
    @IsIn(['single', 'match', 'drag_drop', 'click_boxes', 'image'])
    question_type?: 'single' | 'match' | 'drag_drop' | 'click_boxes' | 'image';

    @ValidateIf((question) => question.question_type !== undefined && question.question_type !== 'single')
    @IsArray()
    @ArrayMinSize(2)
    @ArrayMaxSize(8)
    @IsString({ each: true })
    @Length(1, 500, { each: true })
    match_items?: string[];

    @ValidateIf((question) => question.question_type !== undefined && question.question_type !== 'single')
    @IsArray()
    @ArrayMinSize(2)
    @ArrayMaxSize(8)
    @IsInt({ each: true })
    @Min(0, { each: true })
    match_answer?: number[];

    @ValidateIf((question) => question.question_type === undefined || question.question_type === 'single')
    @IsString()
    @Length(1, 500)
    correct_answer?: string;

    @IsOptional()
    @IsString()
    @Length(1, 1000)
    imageUrl?: string;

    @IsString()
    @MaxLength(5000)
    explanation: string;
}

export class ExamAnswerDto {
    @Type(() => Number)
    @IsInt()
    @Min(1)
    questionId: number;

    @ValidateIf((answer) => answer.selectedMatches === undefined)
    @IsOptional()
    @IsString()
    @MaxLength(500)
    selectedAnswer?: string | null;

    @ValidateIf((answer) => answer.selectedAnswer === undefined)
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(8)
    selectedMatches?: (number | null)[] | null;
}

// Bound nested answer validation to the largest supported exam format.
export class SubmitExamDto {
    @IsArray()
    @ArrayMaxSize(150)
    @ValidateNested({ each: true })
    @Type(() => ExamAnswerDto)
    answers: ExamAnswerDto[];
}
