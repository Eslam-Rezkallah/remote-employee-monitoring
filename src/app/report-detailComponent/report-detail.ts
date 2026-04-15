import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-report-detail',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './report-detail.html',
  styleUrls: ['../dark-theme.css','../../styles.css'],
})
export class ReportDetailComponent {}